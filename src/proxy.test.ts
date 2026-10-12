import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSession, readSession } from "@/lib/auth/session";
import { SESSION_MAX_AGE_S } from "@/lib/auth/session-policy";
import { NEXT_PATH_HEADER } from "@/lib/auth/next-path";
import { config, proxy } from "./proxy";

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

  it("lets a page POST (server action) without cookie through with the page path, so requireUser redirects to /login?next", async () => {
    // Proxy trả 307 cho POST của server action sẽ phá giao thức redirect của action (lần chạm bị nuốt, không về /login).
    const res = await proxy(req("/lop/abc/diem-danh/2026-10-12", { method: "POST" }));
    expect(location(res)).toBeNull();
    expect(forwardedNext(res)).toBe("/lop/abc/diem-danh/2026-10-12");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses (redirects) a validly signed token whose login is older than 90 days, without refreshing it", async () => {
    const old = await encryptSession({ userId: "u1", sat: nowS() - 91 * DAY }, SIGNING_KEY, nowS() + DAY);
    const res = await proxy(req("/lop/abc", { token: old }));
    expect(location(res)).toBe(`${ORIGIN}/login?next=%2Flop%2Fabc`);
    expect(res.cookies.get("session")?.value).toBe("");
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

  it("re-issues a 30-day httpOnly lax cookie when under 3 days remain, keeping sat", async () => {
    const token = await encryptSession({ userId: "u1", sat: nowS() - 50 * DAY }, SIGNING_KEY, nowS() + 2 * DAY);
    const original = await readSession(token, SIGNING_KEY);
    const res = await proxy(req("/lop/abc", { token }));
    expect(location(res)).toBeNull();
    const cookie = res.cookies.get("session");
    expect(cookie?.maxAge).toBe(SESSION_MAX_AGE_S);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    const renewed = await readSession(cookie?.value, SIGNING_KEY);
    expect(renewed?.userId).toBe("u1");
    expect(renewed?.sat).toBe(original!.sat); // thời điểm đăng nhập giữ nguyên qua các lần gia hạn
    expect(renewed!.exp - nowS()).toBeGreaterThan(SESSION_MAX_AGE_S - 5);
  });

  it("does not refresh once the login is older than 90 days (session ends at its exp)", async () => {
    const token = await encryptSession({ userId: "u1", sat: nowS() - 90 * DAY - 60 }, SIGNING_KEY, nowS() + DAY);
    const res = await proxy(req("/lop/abc", { token }));
    expect(location(res)).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
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

  it("forwards the page path for a server-action POST and overwrites a spoofed value", async () => {
    const res = await proxy(req("/lop/abc/diem-danh/2026-10-12", { method: "POST", token: "garbage", headers: { [NEXT_PATH_HEADER]: "//evil.example" } }));
    expect(location(res)).toBeNull();
    expect(forwardedNext(res)).toBe("/lop/abc/diem-danh/2026-10-12");
  });

  it("strips a client-supplied header on /login", async () => {
    const res = await proxy(req("/login", { headers: { [NEXT_PATH_HEADER]: "/lop/abc" } }));
    expect(forwardedNext(res)).toBeNull();
    // Danh sách header được giữ lại không chứa header này => Next xóa nó khỏi request.
    expect(res.headers.get("x-middleware-override-headers")?.split(",")).not.toContain(NEXT_PATH_HEADER);
  });
});

describe("proxy matcher", () => {
  // Next ghép matcher thành ^/(...)$; iOS tải icon/ảnh khởi động không kèm cookie nên chúng phải bỏ qua proxy.
  const matches = (p: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(p));

  it("/api/health nằm ngoài proxy (không bị chuyển về /login khi chưa đăng nhập)", () => {
    expect(matches("/api/health")).toBe(false);
  });

  it.each(["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/splash/iphone-1170x2532.png", "/icon-192.png", "/manifest.webmanifest"])("bỏ qua %s", (p) => {
    expect(matches(p)).toBe(false);
  });

  it.each([
    "/", "/login", "/lop/abc/diem-danh/2026-10-12/quet", "/splash-screen-page",
    "/apple-touch-icon-foo", "/apple-touch-icon.png/x", "/apple-touch-icon.pngx", "/splash", "/splash/", "/splash/a.html", "/splash/a.png/b", "/splash/x/y.png",
  ])("vẫn chạy cho %s", (p) => {
    expect(matches(p)).toBe(true);
  });
});
