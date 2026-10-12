import { describe, expect, it, vi } from "vitest";
import { sendMany } from "./send-many";
import type { PushOutcome, PushTarget } from "./send";

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.vn" };
const message = { title: "t", body: "b", url: "/" };
const targets = (n: number): PushTarget[] => Array.from({ length: n }, (_, i) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys: { p256dh: "p", auth: "a" } }));

describe("sendMany", () => {
  it("returns one result per target in order", async () => {
    const send = vi.fn(async (t: PushTarget) => ({ outcome: (t.endpoint.endsWith("1") ? "gone" : "ok") as PushOutcome, status: 201 }));
    const r = await sendMany(targets(3), message, { vapid, send });
    expect(r.map((x) => x.outcome)).toEqual(["ok", "gone", "ok"]);
    expect(r.map((x) => x.target.endpoint)).toEqual(targets(3).map((t) => t.endpoint));
  });

  it("never runs more than 5 sends at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const send = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { outcome: "ok" as PushOutcome, status: 201 };
    });
    const r = await sendMany(targets(17), message, { vapid, send });
    expect(r).toHaveLength(17);
    expect(send).toHaveBeenCalledTimes(17);
    expect(peak).toBe(5);
  });

  it("gives up on a hanging send after the deadline (retry) and still finishes the others", async () => {
    const send = vi.fn((t: PushTarget) => (t.endpoint.endsWith("/0")
      ? new Promise<never>(() => undefined)
      : Promise.resolve({ outcome: "ok" as PushOutcome, status: 201 })));
    const started = Date.now();
    const r = await sendMany(targets(3), message, { vapid, send, deadlineMs: 50 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.map((x) => x.outcome)).toEqual(["retry", "ok", "ok"]);
  });

  it("turns a sender that throws into an error result", async () => {
    const send = vi.fn(async () => { throw new Error("bug"); });
    expect((await sendMany(targets(1), message, { vapid, send }))[0]).toMatchObject({ outcome: "error", status: null });
  });

  it("defaults to a 15 second deadline", async () => {
    const { SEND_DEADLINE_MS, SEND_CONCURRENCY } = await import("./send-many");
    expect([SEND_DEADLINE_MS, SEND_CONCURRENCY]).toEqual([15_000, 5]);
  });
});
