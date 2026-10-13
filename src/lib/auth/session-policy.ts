/**
 * Chính sách phiên đăng nhập (thuần, dùng được cả ở proxy lẫn DAL).
 * Phiên trượt, giữ đăng nhập lâu: JWT và cookie cùng sống 180 ngày; khi request hợp lệ thấy phiên còn dưới 30 ngày thì
 * cấp lại, nên dùng ít nhất mỗi vài tháng một lần là không bị đăng xuất. Đổi/đặt lại mật khẩu hoặc khoá tài khoản vẫn thu hồi phiên.
 */
const DAY_S = 24 * 60 * 60;

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_S = 180 * DAY_S;
export const SESSION_REFRESH_BELOW_S = 30 * DAY_S;
/** Trần tuyệt đối tính từ lúc đăng nhập (`sat`): quá 1 năm thì phải đăng nhập lại dù vẫn dùng đều. */
export const SESSION_ABSOLUTE_MAX_S = 365 * DAY_S;
/** Thời hạn phiên trước khi đổi chính sách: token cũ không có `sat` được suy ra `sat = exp - 30 ngày`. */
export const LEGACY_SESSION_MAX_AGE_S = 30 * DAY_S;
/** Cho phép đồng hồ lệch nhẹ khi so `exp` với thời hạn tối đa. */
const CLOCK_SKEW_S = 5 * 60;

export type RefreshDecision = "keep" | "refresh" | "invalid";

/** Thời điểm đăng nhập (giây). Token cũ chưa có `sat`: coi như `exp - 30 ngày` (chuyển đổi êm). */
export function sessionAuthTime({ exp, sat }: { exp: number; sat?: number }): number {
  return sat === undefined ? exp - LEGACY_SESSION_MAX_AGE_S : sat;
}

/**
 * Quyết định cho một token ĐÃ kiểm chữ ký, theo `exp` và `sat` (giây). Proxy và DAL dùng chung (cùng một tiêu chí).
 * - `invalid`: hết hạn, thiếu/sai `exp`, `exp` xa hơn thời hạn tối đa, `sat` sai/ở tương lai,
 *   hoặc đã đăng nhập quá 1 năm (+ lệch đồng hồ). Không bao giờ gia hạn.
 * - `keep`: còn hạn; hoặc đã quá 1 năm kể từ đăng nhập (không cấp lại, phiên hết ở `exp` tự nhiên).
 * - `refresh`: còn dưới 30 ngày và chưa quá trần 1 năm.
 */
export function sessionRefreshDecision(exp: number | undefined, nowS: number, sat?: number): RefreshDecision {
  if (typeof exp !== "number" || !Number.isFinite(exp)) return "invalid";
  const remaining = exp - nowS;
  if (remaining <= 0) return "invalid";
  if (remaining > SESSION_MAX_AGE_S + CLOCK_SKEW_S) return "invalid";
  const authTime = sessionAuthTime({ exp, sat });
  if (!Number.isFinite(authTime) || authTime > nowS + CLOCK_SKEW_S) return "invalid";
  const age = nowS - authTime;
  if (age > SESSION_ABSOLUTE_MAX_S + CLOCK_SKEW_S) return "invalid";
  if (age > SESSION_ABSOLUTE_MAX_S) return "keep";
  return remaining < SESSION_REFRESH_BELOW_S ? "refresh" : "keep";
}

/** Mốc đổi mật khẩu làm tròn xuống giây: cùng độ phân giải với `sat` (giây) của phiên. */
export function passwordChangeSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/**
 * Phiên đã bị thu hồi vì đổi/đặt lại mật khẩu: `sat` (lúc đăng nhập, giây) TRƯỚC mốc `password_changed_at` (cắt về giây).
 * Cùng giây thì vẫn hợp lệ: thiết bị vừa đổi mật khẩu được cấp lại phiên với `sat` = bây giờ (≥ mốc đổi).
 * Hệ quả biết trước: phiên đăng nhập ở thiết bị khác trong ĐÚNG giây đổi mật khẩu cũng được giữ.
 * `null` (chưa đổi lần nào, kể cả dữ liệu trước khi có cột) không thu hồi gì. Chỉ DAL gọi (cần dữ liệu DB); proxy không gọi.
 */
export function sessionRevokedByPasswordChange(sat: number, passwordChangedAt: Date | null): boolean {
  if (!passwordChangedAt) return false;
  return sat < Math.floor(passwordChangedAt.getTime() / 1000);
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
