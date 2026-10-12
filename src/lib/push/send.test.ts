import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({ default: { sendNotification: (...args: unknown[]) => sendNotification(...args) } }));

const { PUSH_TTL_SECONDS, classifyPushStatus, sendPush } = await import("./send");

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
    [429, "retry"], [500, "retry"], [502, "retry"], [503, "retry"], [undefined, "retry"],
    [400, "error"], [401, "error"], [403, "error"], [413, "error"],
  ] as const)("%s -> %s", (status, outcome) => expect(classifyPushStatus(status)).toBe(outcome));
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

  it.each([[404, "gone"], [410, "gone"], [429, "retry"], [500, "retry"], [503, "retry"], [400, "error"], [403, "error"]] as const)(
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
});
