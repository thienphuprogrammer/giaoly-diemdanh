/**
 * Cấu hình VAPID (khoá ký Web Push) từ biến môi trường. Thuần, test được. Thông điệp lỗi chỉ nêu TÊN biến, không bao
 * giờ chứa giá trị. Sinh khoá: `pnpm push:keys` (in ra màn hình, không ghi tệp). Không commit khoá.
 */
type Env = Record<string, string | undefined>;

export interface VapidConfig { publicKey: string; privateKey: string; subject: string }

export class VapidConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Cấu hình thông báo đẩy (VAPID) không hợp lệ: ${problems.join(" ")}`);
    this.name = "VapidConfigError";
  }
}

const B64URL = /^[A-Za-z0-9_-]+$/;
const decode = (v: string) => (B64URL.test(v) ? Buffer.from(v, "base64url") : null);

/** Khoá công khai P-256 không nén: 65 byte, byte đầu 0x04 (dạng `applicationServerKey` của trình duyệt). */
export function isVapidPublicKey(v: string): boolean {
  const bytes = decode(v);
  return bytes !== null && bytes.length === 65 && bytes[0] === 4;
}

const isVapidPrivateKey = (v: string) => decode(v)?.length === 32;

/** `mailto:địa-chỉ` hoặc URL https công khai (dịch vụ push của Apple từ chối localhost). */
export function isVapidSubject(v: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(v)) return true;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname !== "localhost" && !u.hostname.endsWith(".localhost") && !u.username && !u.password;
  } catch {
    return false;
  }
}

export type VapidCheck = { status: "unset" } | { status: "invalid"; problems: string[] } | { status: "ok"; config: VapidConfig };

/** Không đặt biến nào = "unset" (thông báo đẩy tắt); đặt thiếu/sai = "invalid"; đủ và đúng = "ok". */
export function checkVapid(env: Env): VapidCheck {
  const [publicKey, privateKey, subject] = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT].map((v) => v?.trim() ?? "");
  if (!publicKey && !privateKey && !subject) return { status: "unset" };
  const problems = [
    !publicKey ? "Thiếu VAPID_PUBLIC_KEY." : !isVapidPublicKey(publicKey) ? "VAPID_PUBLIC_KEY phải là khoá công khai base64url 65 byte (sinh bằng pnpm push:keys)." : null,
    !privateKey ? "Thiếu VAPID_PRIVATE_KEY." : !isVapidPrivateKey(privateKey) ? "VAPID_PRIVATE_KEY phải là khoá bí mật base64url 32 byte (sinh bằng pnpm push:keys)." : null,
    !subject ? "Thiếu VAPID_SUBJECT." : !isVapidSubject(subject) ? "VAPID_SUBJECT phải có dạng mailto:email@ten-mien hoặc https://ten-mien (không phải localhost)." : null,
  ].filter((p): p is string => p !== null);
  return problems.length > 0 ? { status: "invalid", problems } : { status: "ok", config: { publicKey, privateKey, subject } };
}

/** Dùng khi GỬI: thiếu/sai thì ném (fail closed) với thông điệp nêu tên biến. */
export function vapidFromEnv(env: Env = process.env): VapidConfig {
  const c = checkVapid(env);
  if (c.status === "ok") return c.config;
  throw new VapidConfigError(c.status === "unset" ? ["Thiếu VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT."] : c.problems);
}

/** Khoá công khai cho trình duyệt (prop của trang, đọc lúc chạy, không gắn vào bản build); null khi cấu hình chưa đủ. */
export function vapidPublicKeyFromEnv(env: Env = process.env): string | null {
  const c = checkVapid(env);
  return c.status === "ok" ? c.config.publicKey : null;
}
