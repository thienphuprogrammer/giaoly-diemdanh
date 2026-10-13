import { and, eq, gt, lte } from "drizzle-orm";
import { loginAttempts } from "@/db/schema";
import type { Db } from "@/db/types";
import { MAX_ATTEMPTS, WINDOW_MS, isLockedOut } from "./rate-limit";

/**
 * Khóa bộ đếm cho các lần nhập lại mật khẩu khi ĐÃ đăng nhập (tự đổi mật khẩu, xác nhận thao tác quản trị), theo user id.
 * Tách khỏi bộ đếm đăng nhập (theo email) để người ngoài biết email không thể khóa đường đổi mật khẩu (M2).
 * Không chứa "@" nên không bao giờ trùng một email đăng nhập.
 */
export const accountAttemptKey = (userId: string): string => `acct:${userId}`;

/**
 * Ghi nhận một lượt nhập mật khẩu cho khóa `email` (email đăng nhập hoặc `accountAttemptKey`) rồi cho biết có đang bị khóa
 * không (5 lượt / 15 phút). Ghi TRƯỚC rồi mới đếm: các request song song không thể lách giới hạn.
 */
export async function recordPasswordAttempt(db: Db, email: string, now: Date): Promise<{ locked: boolean }> {
  const since = new Date(now.getTime() - WINDOW_MS);
  await db.delete(loginAttempts).where(and(eq(loginAttempts.email, email), lte(loginAttempts.attemptedAt, since)));
  await db.insert(loginAttempts).values({ email, attemptedAt: now });
  const recent = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, since)));
  // Lượt hiện tại đã nằm trong số đếm nên khóa khi vượt quá MAX_ATTEMPTS.
  return { locked: isLockedOut(recent.map((r) => r.at), now, MAX_ATTEMPTS + 1) };
}

/** Nhập đúng mật khẩu: xóa các lượt đã ghi của khóa này (chỉ khóa này). */
export async function clearPasswordAttempts(db: Db, email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}
