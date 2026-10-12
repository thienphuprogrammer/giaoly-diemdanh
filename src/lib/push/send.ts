import webpush from "web-push";
import { validatePushEndpoint } from "./endpoint";
import { buildPushPayload, type PushMessage } from "./payload";
import type { VapidConfig } from "./vapid";

/**
 * Gửi một thông báo Web Push qua thư viện `web-push` (mã hoá aes128gcm + ký VAPID theo từng lần gọi, không đặt trạng
 * thái toàn cục). Endpoint được KIỂM LẠI ngay trước khi gửi (dòng cũ/sửa tay trong DB không vượt được danh sách cho phép):
 * không hợp lệ thì không liên lạc và báo `gone` để xoá. Kết quả được phân loại để tầng dịch vụ dọn đăng ký:
 * - 2xx `ok`; 404/410 `gone` (đăng ký đã hết hạn/bị thu hồi: xoá);
 * - 429, 5xx, lỗi mạng (ECONNRESET/ETIMEDOUT/ENOTFOUND/ECONNREFUSED/EAI_AGAIN, hết giờ socket) `retry` (xoá sau 5 lần liên tiếp);
 * - 401/403 `auth` (thường do đã đổi khoá VAPID: đếm riêng, xoá sau 10 lần liên tiếp);
 * - mọi lỗi khác (khoá hỏng, lỗi thư viện, mã HTTP khác) `error`: chỉ ghi log mã, KHÔNG đếm để không xoá đăng ký vì lỗi của ta.
 * Không bao giờ ghi log endpoint, khoá hay đối tượng lỗi (WebPushError chứa endpoint).
 */
export const PUSH_TTL_SECONDS = 4 * 60 * 60;
const PUSH_TIMEOUT_MS = 10_000;

export type PushOutcome = "ok" | "gone" | "retry" | "auth" | "error";
export interface PushTarget { endpoint: string; keys: { p256dh: string; auth: string } }
export interface SendPushOptions {
  vapid: VapidConfig;
  ttlSeconds?: number;
  log?: (message: string) => void;
}
export interface SendResult { outcome: PushOutcome; status: number | null }

export function classifyPushStatus(status: number): PushOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  if (status === 401 || status === 403) return "auth";
  return "error";
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "ESOCKETTIMEDOUT", "ECONNABORTED", "EPIPE"]);

const statusOf = (e: unknown): number | undefined => {
  const code = typeof e === "object" && e !== null ? (e as { statusCode?: unknown }).statusCode : undefined;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
};

/** Lỗi bị ném: có mã HTTP thì theo mã; không có thì chỉ lỗi mạng mới là `retry`, còn lại `error`. */
export function classifyPushError(e: unknown): PushOutcome {
  const status = statusOf(e);
  if (status !== undefined) return classifyPushStatus(status);
  if (typeof e !== "object" || e === null) return "error";
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return "retry";
  // web-push hủy yêu cầu quá `timeout` bằng new Error("Socket timeout").
  return e instanceof Error && e.message === "Socket timeout" ? "retry" : "error";
}

const defaultLog = (message: string) => console.warn(message);

export async function sendPush(target: PushTarget, message: PushMessage, opts: SendPushOptions): Promise<SendResult> {
  const log = opts.log ?? defaultLog;
  const endpoint = validatePushEndpoint(target.endpoint);
  if (!endpoint.ok) {
    log("push: stored endpoint no longer allowed, removing");
    return { outcome: "gone", status: null };
  }
  try {
    const res = await webpush.sendNotification(
      { endpoint: endpoint.endpoint, keys: { p256dh: target.keys.p256dh, auth: target.keys.auth } },
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
    const outcome = classifyPushError(e);
    log(`push: send ${outcome} (status ${status ?? "none"})`);
    return { outcome, status: status ?? null };
  }
}
