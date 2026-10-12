/**
 * Nội dung thông báo đẩy `{title, body, url}` (JSON ≤ 2KB). Không đưa tên đầy đủ của em vào đây: thông báo hiện cả
 * trên màn hình khoá (người gọi chịu trách nhiệm nội dung; xem spec §4). `public/sw.js` kiểm lại cùng các giới hạn.
 */
export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 200;
export const PUSH_URL_MAX = 512;
export const PUSH_PAYLOAD_MAX_BYTES = 2048;

export interface PushMessage { title: string; body: string; url: string }

/** Chỉ đường dẫn cùng nguồn bắt đầu bằng `/` (không `//`, không `\`, không khoảng trắng/ký tự điều khiển); còn lại là "/". */
export function safeNotificationUrl(url: unknown): string {
  if (typeof url !== "string" || url.length > PUSH_URL_MAX) return "/";
  if (!/^\/(?![/\\])[\x21-\x7e]*$/.test(url) || url.includes("\\")) return "/";
  return url;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** Bỏ ký tự điều khiển, gọn khoảng trắng, cắt theo ký tự Unicode (không cắt đôi cặp surrogate) kèm "…". */
export function clip(text: unknown, max: number): string {
  const clean = (typeof text === "string" ? text : "").replace(CONTROL, "").replace(/\s+/g, " ").trim();
  const chars = [...clean];
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join("")}…`;
}

export function buildPushPayload(message: PushMessage): string {
  const json = JSON.stringify({ title: clip(message.title, PUSH_TITLE_MAX), body: clip(message.body, PUSH_BODY_MAX), url: safeNotificationUrl(message.url) });
  if (new TextEncoder().encode(json).length <= PUSH_PAYLOAD_MAX_BYTES) return json;
  // Chỉ xảy ra khi tiêu đề/nội dung toàn ký tự phải thoát; bỏ đường dẫn rồi cắt nội dung ngắn hơn.
  return JSON.stringify({ title: clip(message.title, PUSH_TITLE_MAX / 2), body: clip(message.body, PUSH_BODY_MAX / 2), url: "/" });
}
