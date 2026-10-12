import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { PUSH_STATE_LABEL, base64UrlToBytes, isIosDevice, planSync, pushOptOutKey, pushUiState, readOptOut, sameKey, writeOptOut, type PushEnv } from "./client-state";

const base: PushEnv = {
  configured: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true,
  isIos: false, standalone: false, permission: "default", subscribed: false,
};

describe("pushUiState", () => {
  it.each([
    ["server not configured", { configured: false }, "unconfigured"],
    ["iPhone in Safari (not installed)", { isIos: true, hasPushManager: false, hasNotification: false }, "ios_install"],
    ["iPhone installed but old iOS without push", { isIos: true, standalone: true, hasPushManager: false }, "unsupported"],
    ["iPhone installed, iOS 16.4+", { isIos: true, standalone: true }, "off"],
    ["no service worker", { hasServiceWorker: false }, "unsupported"],
    ["no Notification", { hasNotification: false }, "unsupported"],
    ["denied", { permission: "denied" }, "blocked"],
    ["denied even if a stale subscription exists", { permission: "denied", subscribed: true }, "blocked"],
    ["default", {}, "off"],
    ["granted without subscription", { permission: "granted" }, "off"],
    ["granted with subscription", { permission: "granted", subscribed: true }, "on"],
  ] as const)("%s -> %s", (_n, patch, state) => expect(pushUiState({ ...base, ...patch })).toBe(state));

  it("has a Vietnamese label for every state", () => {
    expect(PUSH_STATE_LABEL).toMatchObject({ on: "Đang bật", off: "Chưa bật", blocked: "Bị chặn trong cài đặt", unsupported: "Không hỗ trợ" });
  });
});

describe("isIosDevice", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15", "iPhone", 5, true],
    ["Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X)", "iPad", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", "MacIntel", 5, true],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0, false],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/129", "Linux armv8l", 5, false],
  ])("%s -> %s", (ua, platform, touch, ios) => expect(isIosDevice(ua, platform, touch)).toBe(ios));
});

describe("base64UrlToBytes / sameKey", () => {
  it("decodes a VAPID public key to its 65 raw bytes", () => {
    const { publicKey } = webpush.generateVAPIDKeys();
    const bytes = base64UrlToBytes(publicKey);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(Buffer.from(bytes).toString("base64url")).toBe(publicKey);
  });

  it("compares the subscription key with the current one", () => {
    const a = base64UrlToBytes(webpush.generateVAPIDKeys().publicKey);
    const b = base64UrlToBytes(webpush.generateVAPIDKeys().publicKey);
    expect(sameKey(a.slice().buffer, a)).toBe(true);
    expect(sameKey(b.buffer, a)).toBe(false);
    expect(sameKey(null, a)).toBe(false);
  });
});

describe("opt-out flag and silent sync plan", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
  };

  it("stores the opt-out per user id and clears it", () => {
    const s = memory();
    expect(readOptOut(s, "u1")).toBe(false);
    writeOptOut(s, "u1", true);
    expect(readOptOut(s, "u1")).toBe(true);
    expect(readOptOut(s, "u2")).toBe(false);
    expect([...s.m.keys()]).toEqual([pushOptOutKey("u1")]);
    writeOptOut(s, "u1", false);
    expect(readOptOut(s, "u1")).toBe(false);
  });

  it("survives storage that throws or is missing", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("x"); } };
    expect(readOptOut(broken, "u1")).toBe(false);
    expect(() => writeOptOut(broken, "u1", true)).not.toThrow();
    expect(readOptOut(null, "u1")).toBe(false);
  });

  it.each([
    ["no subscription, not opted out", { optedOut: false, hasSubscription: false, keyMatches: false }, { dropStale: false, subscribe: true, resend: true }],
    ["no subscription, opted out: stay off", { optedOut: true, hasSubscription: false, keyMatches: false }, { dropStale: false, subscribe: false, resend: false }],
    ["existing subscription: re-send", { optedOut: false, hasSubscription: true, keyMatches: true }, { dropStale: false, subscribe: false, resend: true }],
    ["existing subscription while opted out: still re-send", { optedOut: true, hasSubscription: true, keyMatches: true }, { dropStale: false, subscribe: false, resend: true }],
    ["rotated key: drop and re-subscribe", { optedOut: false, hasSubscription: true, keyMatches: false }, { dropStale: true, subscribe: true, resend: true }],
    ["rotated key while opted out: drop only", { optedOut: true, hasSubscription: true, keyMatches: false }, { dropStale: true, subscribe: false, resend: false }],
  ])("%s", (_n, input, plan) => expect(planSync(input)).toEqual(plan));
});
