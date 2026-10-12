import { randomBytes } from "node:crypto";
import { parse as legacyParse } from "node:url";
import { describe, expect, it } from "vitest";
import { PUSH_ENDPOINT_MAX, PUSH_SERVICE_HOSTS, parsePushSubscription, validatePushEndpoint, validatePushKeys } from "./endpoint";

const b64url = (n: number) => randomBytes(n).toString("base64url");
/** Khoá p256dh hợp lệ: điểm EC không nén (byte đầu 0x04) dài 65 byte, dựng lúc chạy. */
const p256dh = () => Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url");

describe("validatePushEndpoint: accepted push services", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91bDEF-ghi_jkl",
    "https://fcm.googleapis.com/wp/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
    "https://web.push.apple.com/QGx1ZkV2c2R0",
    "https://api.push.apple.com/3/device/abc",
    "https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB",
  ])("accepts %s", (url) => {
    const r = validatePushEndpoint(url);
    expect(r).toEqual({ ok: true, endpoint: url });
  });

  it("normalises an upper-case host of a known service", () => {
    expect(validatePushEndpoint("https://FCM.GOOGLEAPIS.COM/fcm/send/x")).toEqual({ ok: true, endpoint: "https://fcm.googleapis.com/fcm/send/x" });
  });

  it("drops an explicit default port", () => {
    expect(validatePushEndpoint("https://fcm.googleapis.com:443/fcm/send/x")).toEqual({ ok: true, endpoint: "https://fcm.googleapis.com/fcm/send/x" });
  });

  it("keeps the allow-list a fixed constant of exact hosts and dot-prefixed suffixes", () => {
    expect(Object.isFrozen(PUSH_SERVICE_HOSTS)).toBe(true);
    for (const h of PUSH_SERVICE_HOSTS.suffixes) expect(h.startsWith(".")).toBe(true);
  });
});

describe("validatePushEndpoint: attack table", () => {
  it.each([
    ["http scheme", "http://fcm.googleapis.com/fcm/send/x"],
    ["no scheme", "fcm.googleapis.com/fcm/send/x"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/plain,hi"],
    ["file scheme", "file:///etc/passwd"],
    ["credentials", "https://user:pw@fcm.googleapis.com/fcm/send/x"],
    ["username only", "https://user@fcm.googleapis.com/fcm/send/x"],
    ["non default port", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["port 80 on https", "https://fcm.googleapis.com:80/fcm/send/x"],
    ["unknown host", "https://evil.example.com/fcm/send/x"],
    ["allowed host as subdomain of attacker", "https://fcm.googleapis.com.evil.com/x"],
    ["allowed host as prefix", "https://evilfcm.googleapis.com/x"],
    ["sibling of exact host", "https://storage.googleapis.com/x"],
    ["suffix without dot boundary", "https://evilpush.apple.com/x"],
    ["bare suffix domain", "https://push.apple.com.evil.net/x"],
    ["trailing dot", "https://fcm.googleapis.com./fcm/send/x"],
    ["trailing dot on suffix host", "https://web.push.apple.com./x"],
    ["IPv4 literal", "https://142.250.0.1/fcm/send/x"],
    ["IPv4 decimal", "https://2130706433/x"],
    ["IPv4 hex", "https://0x7f000001/x"],
    ["IPv6 literal", "https://[::1]/x"],
    ["IPv6 mapped", "https://[::ffff:127.0.0.1]/x"],
    ["localhost", "https://localhost/x"],
    ["localhost subdomain", "https://fcm.googleapis.com.localhost/x"],
    ["private range", "https://10.0.0.5/x"],
    ["link local metadata", "https://169.254.169.254/latest/meta-data"],
    ["punycode lookalike", "https://xn--fcm-googleapis-com-xyz.com/x"],
    ["unicode lookalike host", "https://fcm.googleаpis.com/x"],
    ["punycode label under suffix", "https://xn--80ak6aa92e.push.apple.com/x"],
    ["backslash host trick", "https:\\\\fcm.googleapis.com/x"],
    ["backslash in authority", "https://evil.com\\@fcm.googleapis.com/x"],
    ["at sign confusion", "https://fcm.googleapis.com@evil.com/x"],
    ["whitespace inside", "https://fcm.goo gleapis.com/x"],
    ["newline inside host", "https://fcm.goo\ngleapis.com/x"],
    ["tab inside", "https://fcm.googleapis.com/\tx"],
    ["leading space", " https://fcm.googleapis.com/x"],
    ["fragment", "https://fcm.googleapis.com/fcm/send/x#y"],
    ["percent encoded host", "https://fcm%2egoogleapis.com/x"],
    ["empty", ""],
    ["too long", `https://fcm.googleapis.com/fcm/send/${"a".repeat(PUSH_ENDPOINT_MAX)}`],
    ["non string", 42],
    ["null", null],
  ])("refuses %s", (_name, url) => {
    const r = validatePushEndpoint(url as string);
    expect(r.ok).toBe(false);
  });

  it("never echoes the refused URL in the reason", () => {
    const secretish = `https://evil.example.com/${b64url(24)}`;
    const r = validatePushEndpoint(secretish);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(secretish);
  });

  it("allows endpoints up to 2048 characters", () => expect(PUSH_ENDPOINT_MAX).toBe(2048));

  it("gives the same hostname to legacy url.parse (used by the https request in web-push) for every accepted href", () => {
    for (const raw of [
      "https://fcm.googleapis.com/fcm/send/abc:APA91bDEF-ghi_jkl",
      "https://FCM.GOOGLEAPIS.COM:443/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk?x=1",
      "https://web.push.apple.com/QGx1ZkV2c2R0",
      "https://wns2-bl2p.notify.windows.com/w/?token=BQYAAAB%2Bx",
      "https://fcm.googleapis.com/a@b/c",
    ]) {
      const r = validatePushEndpoint(raw);
      expect(r.ok, raw).toBe(true);
      if (!r.ok) continue;
      expect(legacyParse(r.endpoint).hostname).toBe(new URL(r.endpoint).hostname);
      expect(legacyParse(r.endpoint).port ?? null).toBeNull();
    }
  });

  it("accepts exactly the maximum length", () => {
    const head = "https://fcm.googleapis.com/fcm/send/";
    expect(validatePushEndpoint(head + "a".repeat(PUSH_ENDPOINT_MAX - head.length)).ok).toBe(true);
    expect(validatePushEndpoint(head + "a".repeat(PUSH_ENDPOINT_MAX - head.length + 1)).ok).toBe(false);
  });
});

describe("validatePushKeys", () => {
  it("accepts a 65-byte uncompressed p256dh and a 16-byte auth secret in base64url", () => {
    expect(validatePushKeys({ p256dh: p256dh(), auth: b64url(16) })).toBe(true);
  });

  it.each([
    ["short p256dh", () => ({ p256dh: b64url(64), auth: b64url(16) })],
    ["long p256dh", () => ({ p256dh: b64url(66), auth: b64url(16) })],
    ["compressed point prefix", () => ({ p256dh: Buffer.concat([Buffer.from([2]), randomBytes(64)]).toString("base64url"), auth: b64url(16) })],
    ["standard base64 alphabet", () => ({ p256dh: p256dh().replace(/-/g, "+").replace(/_/g, "/") + "+/", auth: b64url(16) })],
    ["padded", () => ({ p256dh: `${p256dh()}=`, auth: b64url(16) })],
    ["short auth", () => ({ p256dh: p256dh(), auth: b64url(15) })],
    ["long auth", () => ({ p256dh: p256dh(), auth: b64url(17) })],
    ["empty", () => ({ p256dh: "", auth: "" })],
    ["non string", () => ({ p256dh: 1, auth: null })],
  ])("refuses %s", (_n, make) => {
    expect(validatePushKeys(make() as never)).toBe(false);
  });
});

describe("parsePushSubscription", () => {
  const good = () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: p256dh(), auth: b64url(16) } });

  it("returns a normalised subscription", () => {
    const input = good();
    expect(parsePushSubscription({ ...input, expirationTime: null })).toEqual({ ok: true, value: input });
  });

  it.each([
    ["bad endpoint", { ...good(), endpoint: "https://evil.example.com/x" }],
    ["missing keys", { endpoint: good().endpoint }],
    ["bad keys", { ...good(), keys: { p256dh: "x", auth: "y" } }],
    ["not an object", "nope"],
    ["null", null],
  ])("refuses %s with a Vietnamese message", (_n, input) => {
    const r = parsePushSubscription(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/[ạ-ỹ]|thông báo|Đăng ký/i);
  });
});
