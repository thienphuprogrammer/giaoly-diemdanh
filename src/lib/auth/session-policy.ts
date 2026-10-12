/**
 * Chính sách phiên đăng nhập (thuần, dùng được cả ở proxy lẫn DAL).
 * Phiên trượt: JWT và cookie cùng sống 30 ngày; khi request hợp lệ thấy phiên còn dưới 3 ngày thì cấp lại.
 */
const DAY_S = 24 * 60 * 60;

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_S = 30 * DAY_S;
export const SESSION_REFRESH_BELOW_S = 3 * DAY_S;
/** Cho phép đồng hồ lệch nhẹ khi so `exp` với thời hạn tối đa. */
const CLOCK_SKEW_S = 5 * 60;

export type RefreshDecision = "keep" | "refresh" | "invalid";

/**
 * Quyết định gia hạn dựa trên `exp` (giây) của một token ĐÃ kiểm chữ ký.
 * - `invalid`: hết hạn, thiếu/sai `exp`, hoặc `exp` xa hơn thời hạn tối đa (không bao giờ gia hạn).
 * - `refresh`: còn dưới 3 ngày.
 * - `keep`: còn từ 3 ngày trở lên.
 */
export function sessionRefreshDecision(exp: number | undefined, nowS: number): RefreshDecision {
  if (typeof exp !== "number" || !Number.isFinite(exp)) return "invalid";
  const remaining = exp - nowS;
  if (remaining <= 0) return "invalid";
  if (remaining > SESSION_MAX_AGE_S + CLOCK_SKEW_S) return "invalid";
  return remaining < SESSION_REFRESH_BELOW_S ? "refresh" : "keep";
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

/** Cùng một bộ thuộc tính cho mọi lần đặt cookie phiên (đăng nhập và gia hạn). */
export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  };
}

/** Khóa ký phiên; thiếu hoặc quá ngắn thì dừng hẳn (không bao giờ ký bằng khóa yếu). */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET phải có ít nhất 32 ký tự");
  return s;
}
