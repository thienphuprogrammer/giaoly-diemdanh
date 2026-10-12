import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { pushSubscriptions } from "@/db/schema";
import type { Db } from "@/db/types";
import { createRateLimiter } from "@/lib/rate-limit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import type { PushMessage } from "@/lib/push/payload";
import type { PushOutcome } from "@/lib/push/send";
import { PUSH_MAX_FAILURES, PUSH_MAX_PER_USER, sendTestPush, sendToUser, subscribePush, unsubscribePush } from "./push";

const keys = () => ({ p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"), auth: randomBytes(16).toString("base64url") });
const endpointOf = (n: string | number) => `https://fcm.googleapis.com/fcm/send/dev-${n}`;
const subInput = (n: string | number) => ({ endpoint: endpointOf(n), keys: keys() });
const roomy = () => createRateLimiter({ max: 1000, windowMs: 60_000 });
const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.vn" };

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const rows = (userId?: string) => db.select().from(pushSubscriptions).where(userId ? eq(pushSubscriptions.userId, userId) : undefined);
  return { db, b, rows };
}

describe("subscribePush", () => {
  it("stores the caller's own subscription with a capped user agent", async () => {
    const { db, b, rows } = await setup();
    const input = subInput(1);
    expect(await subscribePush(db, b.glv, input, { limiter: roomy(), userAgent: `UA ${"x".repeat(400)}` })).toEqual({ ok: true, data: undefined });
    const [row] = await rows();
    expect(row).toMatchObject({ userId: b.glv.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, failureCount: 0 });
    expect(row.userAgent?.length).toBe(200);
  });

  it("upserts by endpoint: re-subscribing refreshes keys and resets failures instead of duplicating", async () => {
    const { db, b, rows } = await setup();
    await subscribePush(db, b.glv, subInput(1), { limiter: roomy() });
    await db.update(pushSubscriptions).set({ failureCount: 3 });
    const again = { endpoint: endpointOf(1), keys: keys() };
    await subscribePush(db, b.glv, again, { limiter: roomy() });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ p256dh: again.keys.p256dh, failureCount: 0 });
  });

  it("moves an endpoint to the caller when the device switches accounts (the other user loses it)", async () => {
    const { db, b, rows } = await setup();
    await subscribePush(db, b.otherGlv, subInput(7), { limiter: roomy() });
    await subscribePush(db, b.glv, subInput(7), { limiter: roomy() });
    expect(await rows(b.otherGlv.id)).toEqual([]);
    expect((await rows(b.glv.id)).map((r) => r.endpoint)).toEqual([endpointOf(7)]);
  });

  it(`keeps at most ${PUSH_MAX_PER_USER} subscriptions per user, dropping the oldest`, async () => {
    const { db, b, rows } = await setup();
    for (let i = 0; i < PUSH_MAX_PER_USER; i++) {
      await db.insert(pushSubscriptions).values({ userId: b.glv.id, endpoint: endpointOf(i), ...keys(), createdAt: new Date(Date.UTC(2026, 0, 1 + i)) });
    }
    await subscribePush(db, b.otherGlv, subInput("other"), { limiter: roomy() });
    await subscribePush(db, b.glv, subInput("new"), { limiter: roomy() });
    const mine = (await rows(b.glv.id)).map((r) => r.endpoint);
    expect(mine).toHaveLength(PUSH_MAX_PER_USER);
    expect(mine).not.toContain(endpointOf(0));
    expect(mine).toContain(endpointOf("new"));
    expect(await rows(b.otherGlv.id)).toHaveLength(1);
  });

  it.each([
    ["foreign endpoint (SSRF)", { endpoint: "https://169.254.169.254/latest", keys: keys() }],
    ["internal host", { endpoint: "https://localhost/x", keys: keys() }],
    ["bad keys", { endpoint: endpointOf(1), keys: { p256dh: "abc", auth: "def" } }],
    ["garbage", "nope"],
  ])("refuses %s and stores nothing", async (_n, input) => {
    const { db, b, rows } = await setup();
    const r = await subscribePush(db, b.glv, input, { limiter: roomy() });
    expect(r.ok).toBe(false);
    expect(await rows()).toEqual([]);
  });

  it("rate limits per user", async () => {
    const { db, b, rows } = await setup();
    const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
    expect((await subscribePush(db, b.glv, subInput(1), { limiter })).ok).toBe(true);
    expect((await subscribePush(db, b.glv, subInput(2), { limiter })).ok).toBe(true);
    const third = await subscribePush(db, b.glv, subInput(3), { limiter });
    expect(third.ok).toBe(false);
    expect(await rows()).toHaveLength(2);
    expect((await subscribePush(db, b.otherGlv, subInput(4), { limiter })).ok).toBe(true);
  });
});

describe("unsubscribePush", () => {
  it("removes only the caller's own subscription; another user's endpoint is untouched", async () => {
    const { db, b, rows } = await setup();
    await subscribePush(db, b.glv, subInput(1), { limiter: roomy() });
    await subscribePush(db, b.otherGlv, subInput(2), { limiter: roomy() });
    expect(await unsubscribePush(db, b.glv, { endpoint: endpointOf(2) }, { limiter: roomy() })).toEqual({ ok: true, data: undefined });
    expect(await rows()).toHaveLength(2);
    expect((await unsubscribePush(db, b.glv, { endpoint: endpointOf(1) }, { limiter: roomy() })).ok).toBe(true);
    expect((await rows()).map((r) => r.userId)).toEqual([b.otherGlv.id]);
  });

  it("refuses a malformed endpoint and is rate limited", async () => {
    const { db, b } = await setup();
    expect((await unsubscribePush(db, b.glv, { endpoint: "javascript:x" }, { limiter: roomy() })).ok).toBe(false);
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    await unsubscribePush(db, b.glv, { endpoint: endpointOf(1) }, { limiter });
    expect((await unsubscribePush(db, b.glv, { endpoint: endpointOf(1) }, { limiter })).ok).toBe(false);
  });
});

/** Gửi giả lập: kết quả theo endpoint. */
const fakeSend = (byEndpoint: Record<string, PushOutcome>) =>
  vi.fn<(target: { endpoint: string }, message: PushMessage, opts: unknown) => Promise<{ outcome: PushOutcome; status: null }>>(
    async (target) => ({ outcome: byEndpoint[target.endpoint] ?? "ok", status: null }));

async function seeded(db: Db, userId: string, ns: (string | number)[]) {
  for (const n of ns) await db.insert(pushSubscriptions).values({ userId, endpoint: endpointOf(n), ...keys() });
}

describe("sendToUser", () => {
  it("records success, deletes 404/410 endpoints, counts transient failures and leaves other errors alone", async () => {
    const { db, b, rows } = await setup();
    await seeded(db, b.glv.id, ["ok", "gone", "retry", "error"]);
    await seeded(db, b.otherGlv.id, ["someone-else"]);
    await db.update(pushSubscriptions).set({ failureCount: 2 }).where(eq(pushSubscriptions.endpoint, endpointOf("ok")));
    const send = fakeSend({ [endpointOf("gone")]: "gone", [endpointOf("retry")]: "retry", [endpointOf("error")]: "error" });
    expect(await sendToUser(db, b.glv.id, { title: "t", body: "b", url: "/" }, { vapid, send })).toEqual({ sent: 1, removed: 1, failed: 2 });
    expect(send).toHaveBeenCalledTimes(4);
    const byEndpoint = Object.fromEntries((await rows(b.glv.id)).map((r) => [r.endpoint, r]));
    expect(Object.keys(byEndpoint).sort()).toEqual([endpointOf("error"), endpointOf("ok"), endpointOf("retry")].sort());
    expect(byEndpoint[endpointOf("ok")]).toMatchObject({ failureCount: 0 });
    expect(byEndpoint[endpointOf("ok")].lastOkAt).toBeInstanceOf(Date);
    expect(byEndpoint[endpointOf("retry")].failureCount).toBe(1);
    expect(byEndpoint[endpointOf("error")].failureCount).toBe(0);
    expect(await rows(b.otherGlv.id)).toHaveLength(1);
  });

  it(`deletes a subscription after ${PUSH_MAX_FAILURES} consecutive transient failures`, async () => {
    const { db, b, rows } = await setup();
    await seeded(db, b.glv.id, ["flaky"]);
    const send = fakeSend({ [endpointOf("flaky")]: "retry" });
    for (let i = 1; i < PUSH_MAX_FAILURES; i++) await sendToUser(db, b.glv.id, { title: "t", body: "b", url: "/" }, { vapid, send });
    expect((await rows())[0].failureCount).toBe(PUSH_MAX_FAILURES - 1);
    const last = await sendToUser(db, b.glv.id, { title: "t", body: "b", url: "/" }, { vapid, send });
    expect(last).toEqual({ sent: 0, removed: 1, failed: 1 });
    expect(await rows()).toEqual([]);
  });

  it("does nothing for a user without subscriptions", async () => {
    const { db, b } = await setup();
    const send = fakeSend({});
    expect(await sendToUser(db, b.glv.id, { title: "t", body: "b", url: "/" }, { vapid, send })).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("sendTestPush", () => {
  it("sends a neutral test message only to the caller's own devices", async () => {
    const { db, b } = await setup();
    await seeded(db, b.glv.id, [1, 2]);
    await seeded(db, b.otherGlv.id, [3]);
    const send = fakeSend({});
    expect(await sendTestPush(db, b.glv, { limiter: roomy(), vapid, send })).toEqual({ ok: true, data: { sent: 2 } });
    const targets = send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(targets).toEqual([endpointOf(1), endpointOf(2)]);
    const message = send.mock.calls[0][1];
    expect(message.url).toBe("/tai-khoan");
    expect(message.body).not.toContain(b.glv.name);
  });

  it("explains when push is not configured, when there is no device, when nothing got through, and when rate limited", async () => {
    const { db, b } = await setup();
    const notConfigured = await sendTestPush(db, b.glv, { limiter: roomy(), vapid: null, send: fakeSend({}) });
    expect(notConfigured).toEqual({ ok: false, error: expect.stringContaining("chưa") });
    expect((await sendTestPush(db, b.glv, { limiter: roomy(), vapid, send: fakeSend({}) })).ok).toBe(false);
    await seeded(db, b.glv.id, ["dead"]);
    const dead = await sendTestPush(db, b.glv, { limiter: roomy(), vapid, send: fakeSend({ [endpointOf("dead")]: "gone" }) });
    expect(dead.ok).toBe(false);
    await seeded(db, b.glv.id, [9]);
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect((await sendTestPush(db, b.glv, { limiter, vapid, send: fakeSend({}) })).ok).toBe(true);
    expect((await sendTestPush(db, b.glv, { limiter, vapid, send: fakeSend({}) })).ok).toBe(false);
  });
});

it("subscriptions disappear with their user", async () => {
  const { db, b, rows } = await setup();
  await subscribePush(db, b.glv, subInput(1), { limiter: roomy() });
  await db.execute(sql`delete from users where id = ${b.glv.id}`);
  expect(await rows()).toEqual([]);
});
