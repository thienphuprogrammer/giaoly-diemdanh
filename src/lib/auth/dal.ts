import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import type { AppUser } from "@/lib/access/can-access";
import { NEXT_PATH_HEADER, loginHref } from "./next-path";
import { encryptSession } from "./session";
import { SESSION_COOKIE, authSecret as secret, sessionCookieOptions } from "./session-policy";
import { loadSessionUser } from "./session-user";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * JWT và cookie cùng thời hạn 30 ngày; proxy cấp lại khi còn < 3 ngày (phiên trượt).
 * `authTime` (giây): lúc đăng nhập ghi vào `sat`, mặc định bây giờ. Đổi mật khẩu truyền đúng mốc đổi để phiên mới của
 * thiết bị đó không bao giờ rơi trước `password_changed_at`.
 */
export async function createSession(userId: string, authTime?: number, version?: number): Promise<void> {
  if (version === undefined) {
    const [user] = await db.select({ version: users.sessionVersion, isActive: users.isActive }).from(users).where(eq(users.id, userId));
    if (!user?.isActive) throw new Error("Cannot create session for an unavailable account");
    version = user.version;
  }
  const token = await encryptSession({ userId, sat: authTime, ver: version }, secret());
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Đọc lại user từ DB ở mỗi request: đổi quyền/xóa tài khoản có hiệu lực ngay; phiên đăng nhập trước lần đổi/đặt lại
 * mật khẩu gần nhất bị coi như đã đăng xuất.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> =>
  loadSessionUser(db, (await cookies()).get(SESSION_COOKIE)?.value, secret()));

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  // Đường dẫn hiện tại do proxy chuyển qua header (chỉ với request GET); vẫn được kiểm lại bằng safeNextPath.
  if (!user) redirect(loginHref((await headers()).get(NEXT_PATH_HEADER)));
  return user;
}
