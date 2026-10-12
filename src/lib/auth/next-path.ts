/**
 * Kiểm `?next=` sau đăng nhập: chỉ nhận đường dẫn cùng origin bắt đầu bằng đúng một `/`.
 * Mọi thứ khác (URL tuyệt đối, `//host`, `/\host`, ký tự điều khiển, dạng mã hóa của chúng, quá dài,
 * chính trang /login hay /api/) đều quay về "/". Chống open redirect.
 */
export const MAX_NEXT_LENGTH = 512;
/** Header nội bộ: proxy chuyển đường dẫn trang hiện tại cho requireUser(). Proxy luôn ghi đè/xóa giá trị từ client. */
export const NEXT_PATH_HEADER = "x-dd-next-path";

const FALLBACK = "/";
/** Chỉ ASCII in được (0x21–0x7E): loại khoảng trắng, ký tự điều khiển, ký tự Unicode giống dấu `/`. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_DECODE_ROUNDS = 4;
const BASE = "http://next-path.invalid";

/** Giải mã lặp (bắt mã hóa kép); null nếu mã hóa hỏng hoặc vẫn chưa ổn định sau vài vòng. */
function fullyDecode(value: string): string | null {
  let current = value;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) return current;
    current = decoded;
  }
  return null;
}

function hasDangerousShape(s: string): boolean {
  return s.includes("\\") || /[\x00-\x1f\x7f]/.test(s) || !s.startsWith("/") || s.startsWith("//");
}

function isForbiddenTarget(pathname: string): boolean {
  const p = pathname.toLowerCase();
  return p === "/login" || p.startsWith("/login/") || p === "/api" || p.startsWith("/api/");
}

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return FALLBACK;
  if (!PRINTABLE_ASCII.test(raw) || hasDangerousShape(raw)) return FALLBACK;

  const decoded = fullyDecode(raw);
  if (decoded === null || hasDangerousShape(decoded)) return FALLBACK;

  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== BASE) return FALLBACK;

  const decodedPath = fullyDecode(url.pathname);
  if (decodedPath === null || hasDangerousShape(decodedPath) || isForbiddenTarget(decodedPath)) return FALLBACK;
  // Chuẩn hóa thêm một lần trên dạng đã giải mã (vd. "/x/%2e%2e/api") rồi kiểm lại.
  const normalized = new URL(decodedPath, BASE).pathname;
  if (isForbiddenTarget(normalized)) return FALLBACK;

  return `${url.pathname}${url.search}`;
}

/** Đường tới trang đăng nhập, mang theo `next` khi đó là một trang an toàn khác trang chủ. */
export function loginHref(path: unknown): string {
  const next = safeNextPath(path);
  return next === FALLBACK ? "/login" : `/login?next=${encodeURIComponent(next)}`;
}
