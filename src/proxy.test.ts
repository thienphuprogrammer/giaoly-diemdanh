import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSession, readSession } from "@/lib/auth/session";
import { SESSION_MAX_AGE_S } from "@/lib/auth/session-policy";
import { NEXT_PATH_HEADER } from "@/lib/auth/next-path";
import { proxy } from "./proxy";

const SIGNING_KEY = "k".repeat(40);
const DAY = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);
const ORIGIN = "http://app.test";

function req(path: string, init: { method?: string; token?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.token !== undefined) headers.set("cookie", `session=${init.token}`);
  return new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? "GET", headers });
}
const tokenExpiringIn = (seconds: number) => encryptSession({ userId: "u1" }, SIGNING_KEY, nowS() + seconds);
const location = (res: Response) => res.headers.get("location");
const forwardedNext = (res: Response) => res.headers.get(`x-middleware-request-${NEXT_PATH_HEADER}`);

beforeEach(() => { vi.stubEnv("AUTH_SECRET", SIGNING_KEY); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("proxy: unauthenticated page requests", () => {
  it("redirects a GET without cookie to /login carrying next (path + query)", async () => {
    const res = await proxy(req("/lop/abc/thong-ke?ky=hk1"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Flop%2Fabc%2Fthong-ke%3Fky%3Dhk1`);
  });

  it("omits next for the home page", async () => {
    expect(location(await proxy(req("/")))).toBe(`${ORIGIN}/login`);
  });

  it("drops the internal _rsc query from next", async () => {
    const res = await proxy(req("/lop/abc?_rsc=xyz", { headers: { rsc: "1" } }));
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Flop%2Fabc`);
  });

  it("does not carry next for non-GET requests", async () => {
    const res = await proxy(req("/lop/abc", { method: "POST" }));
    expect(location(res)).toBe(`${ORIGIN}/login`);
  });

  it("redirects an expired token like a missing one and clears the cookie", async () => {
    const res = await proxy(req("/lop/abc", { token: await tokenExpiringIn(-10) }));
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Flop%2Fabc`);
    expect(res.headers.get("set-cookie")).toMatch(/session=;/);
  });

  it("redirects a token signed with another key", async () => {
    const forged = await encryptSession({ userId: "u1" }, "z".repeat(40), nowS() + DAY);
    expect(location(await proxy(req("/lop/abc", { token: forged })))).toBe(`${ORIGIN}/login?next=%2Flop%2Fabc`);
  });

  it("lets a POST with an invalid token through untouched (the server action's requireUser decides), never refreshing", async () => {
    const res = await proxy(req("/lop/abc", { method: "POST", token: "garbage" }));
    expect(location(res)).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("never redirects /login itself", async () => {
    expect(location(await proxy(req("/login?next=%2Flop")))).toBeNull();
    expect(location(await proxy(req("/login", { token: "garbage" })))).toBeNull();
  });
});

describe("proxy: sliding session", () => {
  it("does not re-issue a fresh token", async () => {
    const res = await proxy(req("/", { token: await tokenExpiringIn(20 * DAY) }));
    expect(location(res)).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("re-issues a 30-day httpOnly lax cookie when under 3 days remain", async () => {
    const res = await proxy(req("/lop/abc", { token: await tokenExpiringIn(2 * DAY) }));
    expect(location(res)).toBeNull();
    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(SESSION_MAX_AGE_S);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    const renewed = await readSession(cookie?.value, SIGNING_KEY);
    expect(renewed?.userId).toBe("u1");
    expect(renewed!.exp - nowS()).toBeGreaterThan(SESSION_MAX_AGE_S - 5);
  });

  it("re-issues on a POST with a valid near-expiry token too", async () => {
    const res = await proxy(req("/lop/abc", { method: "POST", token: await tokenExpiringIn(DAY) }));
    expect(res.cookies.get("session")?.maxAge).toBe(SESSION_MAX_AGE_S);
  });
});

describe("proxy: next-path request header for requireUser()", () => {
  it("forwards the current path for GET and overwrites a spoofed value", async () => {
    const res = await proxy(req("/lop/abc?ky=1", { token: await tokenExpiringIn(20 * DAY), headers: { [NEXT_PATH_HEADER]: "//evil.example" } }));
    expect(forwardedNext(res)).toBe("/lop/abc?ky=1");
  });

  it("strips a client-supplied header on POST", async () => {
    const res = await proxy(req("/lop/abc", { method: "POST", token: await tokenExpiringIn(20 * DAY), headers: { [NEXT_PATH_HEADER]: "//evil.example" } }));
    expect(forwardedNext(res)).toBeNull();
    // Danh sách header được giữ lại không chứa header này => Next xóa nó khỏi request.
    expect(res.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(NEXT_PATH_HEADER);
  });
});
