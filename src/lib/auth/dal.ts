import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AppUser } from "@/lib/access/can-access";
import { NEXT_PATH_HEADER, loginHref } from "./next-path";
import { decryptSession, encryptSession } from "./session";
import { SESSION_COOKIE, authSecret as secret, sessionCookieOptions } from "./session-policy";

/** JWT và cookie cùng thời hạn 30 ngày; proxy cấp lại khi còn < 3 ngày (phiên trượt). */
export async function createSession(userId: string): Promise<void> {
  const token = await encryptSession({ userId }, secret());
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Đọc lại user từ DB ở mỗi request: đổi quyền/xóa tài khoản có hiệu lực ngay. */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const session = await decryptSession((await cookies()).get(SESSION_COOKIE)?.value, secret());
  if (!session) return null;
  const [row] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, isGradeHead: row.isGradeHead, gradeId: row.gradeId };
});

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  // Đường dẫn hiện tại do proxy chuyển qua header (chỉ với request GET); vẫn được kiểm lại bằng safeNextPath.
  if (!user) redirect(loginHref((await headers()).get(NEXT_PATH_HEADER)));
  return user;
}
