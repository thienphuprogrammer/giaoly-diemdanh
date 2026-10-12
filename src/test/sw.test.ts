import { readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync("./public/sw.js", "utf8");
const ORIGIN = "https://diemdanh.example.vn";

type Listener = (event: Record<string, unknown>) => void;

/** ServiceWorkerGlobalScope giả: chỉ những gì sw.js được phép dùng. */
function load(clients: { url: string; focus?: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const matchAll = vi.fn(async () => clients);
  const self = {
    addEventListener: (type: string, fn: Listener) => { listeners.set(type, fn); },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined), matchAll, openWindow },
    registration: { showNotification },
    location: { origin: ORIGIN },
  };
  runInNewContext(SOURCE, { self, URL, Array, JSON, Promise });
  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`no ${type} listener`);
    fn({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra });
    await Promise.all(waits);
  };
  return { listeners, self, fire, showNotification, openWindow, matchAll };
}

const pushWith = (data: unknown) => ({ data: data === undefined ? null : { json: () => (typeof data === "string" ? JSON.parse(data) : data) } });

describe("public/sw.js", () => {
  it("is small, has no fetch handler and no caching", () => {
    expect(statSync("./public/sw.js").size).toBeLessThanOrEqual(3072);
    const { listeners } = load();
    expect([...listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"]);
    expect(SOURCE).not.toMatch(/caches|Cache\b|fetch\s*\(|importScripts|eval\(|Function\(/);
  });

  it("skips waiting on install and claims clients on activate", async () => {
    const { fire, self } = load();
    await fire("install");
    await fire("activate");
    expect(self.skipWaiting).toHaveBeenCalled();
    expect(self.clients.claim).toHaveBeenCalled();
  });

  it("shows the notification with the icon and a same-origin url", async () => {
    const { fire, showNotification } = load();
    await fire("push", pushWith({ title: "Nhắc điểm danh", body: "Lớp A chưa điểm danh", url: "/lop/a" }));
    expect(showNotification).toHaveBeenCalledWith("Nhắc điểm danh", expect.objectContaining({ body: "Lớp A chưa điểm danh", icon: "/icon-192.png", data: { url: "/lop/a" } }));
  });

  it.each([
    ["bad JSON", { data: { json: () => { throw new SyntaxError("bad"); } } }],
    ["no data", { data: null }],
    ["array", pushWith([1, 2])],
    ["wrong types", pushWith({ title: 5, body: {}, url: 7 })],
  ])("still shows a notification on %s (iOS revokes silent pushes)", async (_n, event) => {
    const { fire, showNotification } = load();
    await fire("push", event);
    expect(showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, { data: { url: string } }];
    expect(title).toBe("Điểm danh Giáo lý");
    expect(options.data.url).toBe("/");
  });

  it.each(["//evil.com", "javascript:alert(1)", "https://evil.com/x", "/\\evil.com", "\\\\evil.com", "evil", "/a b", `/${"a".repeat(600)}`])(
    "falls back to / for url %s", async (url) => {
      const { fire, showNotification } = load();
      await fire("push", pushWith({ title: "t", body: "b", url }));
      const options = (showNotification.mock.calls[0] as unknown as [string, { data: { url: string } }])[1];
      expect(options.data.url).toBe("/");
    });

  it("truncates title to 80 and body to 200 characters", async () => {
    const { fire, showNotification } = load();
    await fire("push", pushWith({ title: "Ấ".repeat(300), body: "ữ".repeat(900) }));
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, { body: string }];
    expect([...title].length).toBe(80);
    expect([...options.body].length).toBe(200);
  });

  it("on click focuses an already open window at that url", async () => {
    const focus = vi.fn(async () => undefined);
    const { fire, openWindow } = load([{ url: `${ORIGIN}/lop/a`, focus }]);
    const close = vi.fn();
    await fire("notificationclick", { notification: { close, data: { url: "/lop/a" } } });
    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("on click navigates another open app window, or opens a new one", async () => {
    const navigate = vi.fn(async () => undefined);
    const focus = vi.fn(async function (this: unknown) { return this; });
    const app = { url: `${ORIGIN}/`, focus, navigate };
    const { fire } = load([{ url: "https://other.example/", focus: vi.fn() }, app]);
    await fire("notificationclick", { notification: { close: vi.fn(), data: { url: "/can-chu-y" } } });
    expect(navigate).toHaveBeenCalledWith(`${ORIGIN}/can-chu-y`);
    const none = load([]);
    await none.fire("notificationclick", { notification: { close: vi.fn(), data: { url: "//evil.com" } } });
    expect(none.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
