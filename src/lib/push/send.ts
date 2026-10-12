import webpush from "web-push";
import { buildPushPayload, type PushMessage } from "./payload";
import type { VapidConfig } from "./vapid";

/**
 * Gửi một thông báo Web Push qua thư viện `web-push` (mã hoá aes128gcm + ký VAPID theo từng lần gọi, không đặt trạng
 * thái toàn cục). Kết quả được phân loại để tầng dịch vụ dọn đăng ký:
 * - 2xx `ok`; 404/410 `gone` (đăng ký đã hết hạn/bị thu hồi: xoá);
 * - 429, 5xx, lỗi mạng `retry` (tăng `failure_count`, xoá sau 5 lần liên tiếp);
 * - mã khác `error` (thường là cấu hình VAPID/nội dung sai): chỉ ghi log mã trạng thái.
 * Không bao giờ ghi log endpoint, khoá hay đối tượng lỗi (WebPushError chứa endpoint).
 */
export const PUSH_TTL_SECONDS = 4 * 60 * 60;
const PUSH_TIMEOUT_MS = 10_000;

export type PushOutcome = "ok" | "gone" | "retry" | "error";
export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export interface SendPushOptions {
  vapid: VapidConfig;
  ttlSeconds?: number;
  log?: (message: string) => void;
}

export function classifyPushStatus(status: number | undefined): PushOutcome {
  if (status === undefined) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "error";
}

const statusOf = (e: unknown): number | undefined => {
  const code = typeof e === "object" && e !== null ? (e as { statusCode?: unknown }).statusCode : undefined;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
};

const defaultLog = (message: string) => console.warn(message);

export async function sendPush(target: PushTarget, message: PushMessage, opts: SendPushOptions): Promise<{ outcome: PushOutcome; status: number | null }> {
  const log = opts.log ?? defaultLog;
  try {
    const res = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
      buildPushPayload(message),
      {
        TTL: opts.ttlSeconds ?? PUSH_TTL_SECONDS,
        urgency: "normal",
        timeout: PUSH_TIMEOUT_MS,
        vapidDetails: { subject: opts.vapid.subject, publicKey: opts.vapid.publicKey, privateKey: opts.vapid.privateKey },
      },
    );
    return { outcome: classifyPushStatus(res.statusCode), status: res.statusCode };
  } catch (e) {
    const status = statusOf(e);
    const outcome = classifyPushStatus(status);
    log(`push: send ${outcome} (status ${status ?? "network"})`);
    return { outcome, status: status ?? null };
  }
}
