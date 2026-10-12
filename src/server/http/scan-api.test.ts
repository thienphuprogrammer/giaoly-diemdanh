import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { sessions, students } from "@/db/schema";
import { createRateLimiter } from "@/lib/rate-limit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { handleScanApi, isSameOrigin } from "./scan-api";

const HOST = "app.example.com";
const goodHeaders = { "content-type": "application/json", origin: `https://${HOST}`, host: HOST };

async function setup(max = 1000, rosterMax = 1000) {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const deps = (user: typeof b.glv | null) => ({ db, getUser: async () => user, limiter: createRateLimiter({ max, windowMs: 60_000 }), rosterLimiter: createRateLimiter({ max: rosterMax, windowMs: 60_000 }) });
  const post = (body: unknown, headers: Record<string, string> = goodHeaders) =>
    new Request(`https://${HOST}/api/diem-danh/quet`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const scanBody = (token = an.qrToken) => ({ eventId: crypto.randomUUID(), sessionId: session.id, kind: "scan", token, mode: "present" });
  return { db, b, session, an, deps, post, scanBody };
}

describe("isSameOrigin", () => {
  it("accepts only an Origin whose host equals the request host", () => {
    expect(isSameOrigin(new Headers({ origin: `https://${HOST}`, host: HOST }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "not a url", host: HOST }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: `https://${HOST}`, "x-forwarded-host": HOST, host: "internal:3000" }))).toBe(true);
  });

  it("uses only the first entry of a comma-separated X-Forwarded-Host", () => {
    expect(isSameOrigin(new Headers({ origin: `https://${HOST}`, "x-forwarded-host": `${HOST}, proxy.internal`, host: "internal:3000" }))).toBe(true);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", "x-forwarded-host": `${HOST}, evil.example`, host: "internal:3000" }))).toBe(false);
    expect(isSameOrigin(new Headers({ origin: "https://evil.example", "x-forwarded-host": `evil.example,${HOST}`, host: HOST }))).toBe(true);
  });
});

describe("handleScanApi POST", () => {
  it("scans for a logged-in catechist and sets no-store", async () => {
    const { b, deps, post, scanBody } = await setup();
    const res = await handleScanApi("scan", post(scanBody()), deps(b.glv));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ ok: true, data: { result: "applied", status: "present" } });
  });

  it("rejects anonymous callers (401), foreign origins (403), non-JSON (415), oversized (413), bad JSON (400)", async () => {
    const { b, deps, post, scanBody } = await setup();
    expect((await handleScanApi("scan", post(scanBody()), deps(null))).status).toBe(401);
    expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, origin: "https://evil.example" }), deps(b.glv))).status).toBe(403);
    expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, "content-type": "text/plain" }), deps(b.glv))).status).toBe(415);
    expect((await handleScanApi("scan", post("x".repeat(5000)), deps(b.glv))).status).toBe(413);
    expect((await handleScanApi("scan", post("{not json"), deps(b.glv))).status).toBe(400);
  });

  it("maps business outcomes: forbidden -> 404, invalid card -> 200 ok:false, event conflict -> 409", async () => {
    const { b, deps, post, scanBody } = await setup();
    const forHead = await handleScanApi("scan", post(scanBody()), deps(b.head));
    expect(forHead.status).toBe(404);
    const bad = await handleScanApi("scan", post(scanBody("a".repeat(32))), deps(b.glv));
    expect(bad.status).toBe(200);
    expect(await bad.json()).toMatchObject({ ok: false, code: "invalid_card" });
    const body = scanBody();
    await handleScanApi("scan", post(body), deps(b.glv));
    const conflict = await handleScanApi("scan", post({ ...body, mode: "late" }), deps(b.glv));
    expect(conflict.status).toBe(409);
  });

  it("rate limits per user with 429 and Retry-After", async () => {
    const { b, post, scanBody, db } = await setup();
    const d = { db, getUser: async () => b.glv, limiter: createRateLimiter({ max: 2, windowMs: 60_000 }), rosterLimiter: createRateLimiter({ max: 1000, windowMs: 60_000 }) };
    await handleScanApi("scan", post(scanBody()), d);
    await handleScanApi("scan", post(scanBody()), d);
    const res = await handleScanApi("scan", post(scanBody()), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("undo goes through the same guards", async () => {
    const { b, session, deps, post, scanBody } = await setup();
    const body = scanBody();
    await handleScanApi("scan", post(body), deps(b.glv));
    const ok = await handleScanApi("undo", post({ eventId: crypto.randomUUID(), sessionId: session.id, targetEventId: body.eventId }), deps(b.glv));
    expect(await ok.json()).toMatchObject({ ok: true, data: { status: null } });
    const anon = await handleScanApi("undo", post({}), deps(null));
    expect(anon.status).toBe(401);
  });
});

describe("handleScanApi GET roster", () => {
  const get = (sessionId: string, headers: Record<string, string> = {}) =>
    new Request(`https://${HOST}/api/diem-danh/bang-tra?sessionId=${sessionId}`, { headers: { host: HOST, ...headers } });

  it("returns tokens only to writers, with no-store, and 404 to everyone else", async () => {
    const { b, an, session, deps } = await setup();
    const res = await handleScanApi("roster", get(session.id), deps(b.glv));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const json = await res.json();
    expect(json.data.students[0]).toMatchObject({ fullName: "An", token: an.qrToken });
    expect((await handleScanApi("roster", get(session.id), deps(b.head))).status).toBe(404);
    expect((await handleScanApi("roster", get(session.id), deps(b.otherGlv))).status).toBe(404);
    expect((await handleScanApi("roster", get(session.id), deps(null))).status).toBe(401);
  });

  it("refuses cross-site fetches", async () => {
    const { b, session, deps } = await setup();
    const res = await handleScanApi("roster", get(session.id, { "sec-fetch-site": "cross-site" }), deps(b.glv));
    expect(res.status).toBe(403);
  });
});

describe("handleScanApi hardening", () => {
  it("refuses a body whose declared length is too large without reading it", async () => {
    const { b, deps } = await setup();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 1000) c.close(); },
    });
    const req = new Request(`https://${HOST}/api/diem-danh/quet`, {
      method: "POST", headers: { ...goodHeaders, "content-length": "10000000" }, body: stream, duplex: "half",
    } as RequestInit);
    const res = await handleScanApi("scan", req, deps(b.glv));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("stops reading a streamed body once it passes the limit", async () => {
    const { b, deps } = await setup();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { pulled++; c.enqueue(new Uint8Array(1024)); if (pulled > 1000) c.close(); },
    });
    const req = new Request(`https://${HOST}/api/diem-danh/quet`, { method: "POST", headers: goodHeaders, body: stream, duplex: "half" } as RequestInit);
    const res = await handleScanApi("scan", req, deps(b.glv));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("turns unexpected failures into a bare 500 that leaks no detail", async () => {
    const { b, post, scanBody, an } = await setup();
    const marker = `failed query params ${an.qrToken}`;
    const brokenDb = new Proxy({}, { get: () => { throw new Error(marker); } }) as never;
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => { logged.push(...args); });
    try {
      const res = await handleScanApi("scan", post(scanBody()), { db: brokenDb, getUser: async () => b.glv, limiter: createRateLimiter({ max: 10, windowMs: 1000 }), rosterLimiter: createRateLimiter({ max: 10, windowMs: 1000 }) });
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const text = await res.text();
      expect(text).not.toContain(an.qrToken);
      expect(JSON.parse(text)).toMatchObject({ ok: false });
      expect(JSON.stringify(logged.map(String))).not.toContain(an.qrToken);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("handleScanApi fix round 1", () => {
  it("requires exactly the application/json media type", async () => {
    const { b, deps, post, scanBody } = await setup();
    for (const ct of ["text/plain; foo=application/json", "application/json-patch+json", "text/application/json"]) {
      expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, "content-type": ct }), deps(b.glv))).status).toBe(415);
    }
    for (const ct of ["application/json; charset=utf-8", "Application/JSON"]) {
      expect((await handleScanApi("scan", post(scanBody(), { ...goodHeaders, "content-type": ct }), deps(b.glv))).status).toBe(200);
    }
  });

  it("rate limits the roster per user with its own limiter (429, no-store, Retry-After)", async () => {
    const { b, session, deps } = await setup(1000, 2);
    const d = deps(b.glv);
    const get = () => new Request(`https://${HOST}/api/diem-danh/bang-tra?sessionId=${session.id}`, { headers: { host: HOST } });
    expect((await handleScanApi("roster", get(), d)).status).toBe(200);
    expect((await handleScanApi("roster", get(), d)).status).toBe(200);
    const res = await handleScanApi("roster", get(), d);
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("has no results route: the unused /api/diem-danh/ket-qua surface was removed", () => {
    expect(existsSync("./src/app/api/diem-danh/ket-qua")).toBe(false);
  });

  it("lets Next.js control-flow errors propagate instead of turning them into a 500", async () => {
    const { b, post, scanBody } = await setup();
    const { notFound } = await import("next/navigation");
    const getUser = async () => { notFound(); return b.glv; };
    const limiter = createRateLimiter({ max: 10, windowMs: 1000 });
    await expect(handleScanApi("scan", post(scanBody()), { db: {} as never, getUser, limiter, rosterLimiter: limiter })).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK") });
  });
});
