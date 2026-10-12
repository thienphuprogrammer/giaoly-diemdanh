/**
 * Kiểm tra đăng ký Web Push do trình duyệt gửi lên (thuần, không mạng). Máy chủ sẽ POST tới `endpoint` nên đây là chốt
 * chống SSRF: chỉ chấp nhận HTTPS tới đúng các dịch vụ push đã biết, không thông tin đăng nhập, không cổng lạ,
 * không IP/localhost, không punycode, không dấu chấm cuối. Danh sách chỉ mở rộng bằng cách sửa hằng số này (không qua env).
 *
 * Dịch vụ push hiện dùng (endpoint do trình duyệt cấp, tra 10/2026):
 * - Chrome, Edge Android, Samsung Internet, Opera, Brave: `fcm.googleapis.com` (`/fcm/send/…`, `/wp/…`).
 * - Firefox: `updates.push.services.mozilla.com` (`/wpush/v1|v2/…`).
 * - Safari macOS 13+ / iOS-iPadOS 16.4+ (PWA đã Thêm vào Màn hình chính): `web.push.apple.com`; nhận cả `*.push.apple.com`.
 * - Edge trên Windows: Windows Push Notification Services `*.notify.windows.com` (ví dụ `wns2-bl2p.notify.windows.com`).
 * Không nhận `android.googleapis.com` (GCM cũ, đã ngừng) hay `*.push.microsoft.com` (không phải endpoint Web Push).
 */

/** Endpoint thật thường 150–500 ký tự; WNS có thể dài hơn. 2048 vẫn chặn dữ liệu rác. */
export const PUSH_ENDPOINT_MAX = 2048;

export const PUSH_SERVICE_HOSTS = Object.freeze({
  exact: Object.freeze(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"] as const),
  /** Hậu tố có dấu chấm đầu: chỉ khớp tên miền con thật (`a.push.apple.com`), không khớp `evilpush.apple.com`. */
  suffixes: Object.freeze([".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"] as const),
});

export type EndpointCheck = { ok: true; endpoint: string } | { ok: false; reason: "format" | "length" | "host" };

/**
 * Hình dạng thô trước khi parse: `https://` + tên máy chỉ gồm chữ/số/chấm/gạch + tuỳ chọn `:443` + đường dẫn ASCII in được.
 * Chặn sớm `@` (thông tin đăng nhập), `\`, `%` trong tên máy, `[`…`]` (IPv6), khoảng trắng/ký tự điều khiển, cổng khác.
 */
const RAW = /^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:\/[\x21-\x7e]*)?$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isAllowedHost(host: string): boolean {
  if (IPV4.test(host) || host === "localhost" || host.endsWith(".localhost")) return false;
  const labels = host.split(".");
  if (labels.some((l) => !LABEL.test(l) || l.startsWith("xn--"))) return false;
  return (PUSH_SERVICE_HOSTS.exact as readonly string[]).includes(host)
    || PUSH_SERVICE_HOSTS.suffixes.some((s) => host.endsWith(s) && host.length > s.length);
}

/** Không bao giờ đưa URL bị từ chối vào kết quả (có thể chứa mã định danh thiết bị). */
export function validatePushEndpoint(raw: unknown): EndpointCheck {
  if (typeof raw !== "string" || raw === "") return { ok: false, reason: "format" };
  if (raw.length > PUSH_ENDPOINT_MAX) return { ok: false, reason: "length" };
  if (!RAW.test(raw) || raw.includes("#") || raw.includes("\\")) return { ok: false, reason: "format" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "format" };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "" || url.hash) return { ok: false, reason: "format" };
  if (!isAllowedHost(url.hostname)) return { ok: false, reason: "host" };
  const endpoint = url.href;
  return endpoint.length > PUSH_ENDPOINT_MAX ? { ok: false, reason: "length" } : { ok: true, endpoint };
}

const B64URL = /^[A-Za-z0-9_-]+$/;

function decodedLength(value: unknown): Buffer | null {
  if (typeof value !== "string" || !B64URL.test(value)) return null;
  return Buffer.from(value, "base64url");
}

/** p256dh: điểm P-256 không nén (65 byte, byte đầu 0x04); auth: 16 byte. Cả hai base64url không đệm. */
export function validatePushKeys(keys: { p256dh: unknown; auth: unknown }): boolean {
  const pub = decodedLength(keys.p256dh);
  const auth = decodedLength(keys.auth);
  return pub !== null && pub.length === 65 && pub[0] === 4 && auth !== null && auth.length === 16;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const INVALID_SUBSCRIPTION = "Đăng ký thông báo không hợp lệ. Hãy thử bật lại thông báo.";

/** Dữ liệu `PushSubscription.toJSON()` từ trình duyệt -> đăng ký đã chuẩn hoá, hoặc lỗi tiếng Việt chung (không lộ chi tiết). */
export function parsePushSubscription(input: unknown): { ok: true; value: PushSubscriptionInput } | { ok: false; error: string } {
  if (!isObject(input) || !isObject(input.keys)) return { ok: false, error: INVALID_SUBSCRIPTION };
  const endpoint = validatePushEndpoint(input.endpoint);
  if (!endpoint.ok) return { ok: false, error: INVALID_SUBSCRIPTION };
  const keys = { p256dh: input.keys.p256dh, auth: input.keys.auth };
  if (!validatePushKeys(keys)) return { ok: false, error: INVALID_SUBSCRIPTION };
  return { ok: true, value: { endpoint: endpoint.endpoint, keys: keys as { p256dh: string; auth: string } } };
}
