import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...args: unknown[]) => sendNotification(...args) } }));

const { PUSH_TTL_SECONDS, classifyPushError, classifyPushStatus, sendPush } = await import("./send");

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.vn" };
const endpoint = "https://fcm.googleapis.com/fcm/send/device-id-123";
const sub = { endpoint, keys: { p256dh: "p", auth: "a" } };
const payload = { title: "Tiêu đề", body: "Nội dung", url: "/" };

/** Lỗi giống WebPushError: có statusCode và endpoint (không bao giờ được ghi log). */
const pushError = (statusCode: number) => Object.assign(new Error("Received unexpected response code"), { statusCode, endpoint, body: "x", headers: {} });

describe("classifyPushStatus", () => {
  it.each([
    [201, "ok"], [200, "ok"], [202, "ok"],
    [404, "gone"], [410, "gone"],
    [429, "retry"], [500, "retry"], [502, "retry"], [503, "retry"],
    [401, "auth"], [403, "auth"],
    [400, "error"], [413, "error"],
  ] as const)("%s -> %s", (status, outcome) => expect(classifyPushStatus(status)).toBe(outcome));
});

describe("classifyPushError (thrown without an HTTP status)", () => {
  it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN"])("network code %s -> retry", (code) => {
    expect(classifyPushError(Object.assign(new Error("x"), { code }))).toBe("retry");
  });
  it("socket timeout from web-push -> retry", () => expect(classifyPushError(new Error("Socket timeout"))).toBe("retry"));
  it.each([
    ["bad key material", new Error("The subscription p256dh value should be 65 bytes long.")],
    ["library type error", new TypeError("Cannot read properties of undefined")],
    ["non error", "boom"],
    ["unknown code", Object.assign(new Error("x"), { code: "ERR_OSSL_EVP_BAD_DECRYPT" })],
  ])("%s -> error (never counts toward deleting the subscription)", (_n, e) => expect(classifyPushError(e)).toBe("error"));
  it("an HTTP status on the error wins", () => expect(classifyPushError(pushError(410))).toBe("gone"));
});

describe("sendPush", () => {
  const log = vi.fn();
  beforeEach(() => { sendNotification.mockReset(); log.mockReset(); });

  it("sends an encrypted JSON payload with TTL, normal urgency, no topic and per-call VAPID details", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    expect(await sendPush(sub, payload, { vapid, log })).toEqual({ outcome: "ok", status: 201 });
    const [s, body, options] = sendNotification.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(s).toEqual(sub);
    expect(JSON.parse(body)).toEqual(payload);
    expect(options).toMatchObject({
      TTL: PUSH_TTL_SECONDS, urgency: "normal",
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    });
    expect(options).not.toHaveProperty("topic");
    expect(typeof options.timeout).toBe("number");
    expect(log).not.toHaveBeenCalled();
  });

  it.each([[404, "gone"], [410, "gone"], [429, "retry"], [500, "retry"], [503, "retry"], [400, "error"], [403, "auth"]] as const)(
    "classifies a %s rejection as %s and logs only the status code", async (status, outcome) => {
      sendNotification.mockRejectedValue(pushError(status));
      expect(await sendPush(sub, payload, { vapid, log })).toEqual({ outcome, status });
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).toContain(String(status));
      expect(logged).not.toContain(endpoint);
      expect(logged).not.toContain("device-id-123");
      expect(logged).not.toContain(vapid.privateKey);
    });

  it("treats a network error (no status code) as retry without logging the error object", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error(`connect ECONNREFUSED ${endpoint}`), { code: "ECONNREFUSED" }));
    expect(await sendPush(sub, payload, { vapid, log })).toEqual({ outcome: "retry", status: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain("device-id-123");
  });

  it("treats a local library error as error, not retry", async () => {
    sendNotification.mockRejectedValue(new Error("The subscription auth value should be at least 16 bytes long"));
    expect(await sendPush(sub, payload, { vapid, log })).toEqual({ outcome: "error", status: null });
  });

  it.each([
    "https://169.254.169.254/latest/meta-data",
    "https://evil.example.com/fcm/send/x",
    "http://fcm.googleapis.com/fcm/send/x",
  ])("re-validates the endpoint at send time: %s is never contacted and reported as gone", async (bad) => {
    expect(await sendPush({ ...sub, endpoint: bad }, payload, { vapid, log })).toEqual({ outcome: "gone", status: null });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(bad);
  });
});

describe("PUSH_DRY_RUN (chỉ dev/test, chỉ bằng biến môi trường)", () => {
  const log = vi.fn();
  beforeEach(() => { sendNotification.mockReset(); log.mockReset(); });

  it("isPushDryRun chỉ bật khi PUSH_DRY_RUN=1 VÀ NODE_ENV là test hoặc development", async () => {
    const { isPushDryRun } = await import("./send");
    expect(isPushDryRun({ PUSH_DRY_RUN: "1", NODE_ENV: "test" })).toBe(true);
    expect(isPushDryRun({ PUSH_DRY_RUN: "1", NODE_ENV: "development" })).toBe(true);
    expect(isPushDryRun({ PUSH_DRY_RUN: "1", NODE_ENV: "production" })).toBe(false);
    expect(isPushDryRun({ PUSH_DRY_RUN: "1" })).toBe(false);
    expect(isPushDryRun({ PUSH_DRY_RUN: "true", NODE_ENV: "test" })).toBe(false);
    expect(isPushDryRun({ NODE_ENV: "test" })).toBe(false);
  });

  it("bật: trả ok, không gọi mạng; endpoint ngoài danh sách cho phép vẫn bị loại", async () => {
    const env = { PUSH_DRY_RUN: "1", NODE_ENV: "test" };
    expect(await sendPush(sub, payload, { vapid, log, env })).toEqual({ outcome: "ok", status: null });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(await sendPush({ ...sub, endpoint: "https://169.254.169.254/x" }, payload, { vapid, log, env })).toEqual({ outcome: "gone", status: null });
  });

  it("production: biến bị bỏ qua, gửi thật", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    expect(await sendPush(sub, payload, { vapid, log, env: { PUSH_DRY_RUN: "1", NODE_ENV: "production" } })).toEqual({ outcome: "ok", status: 201 });
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});
