import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import type { AppUser } from "@/lib/access/can-access";
import { decryptSession, encryptSession } from "./session";

export const SESSION_COOKIE = "session";
const MAX_AGE = 7 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET phải có ít nhất 32 ký tự");
  return s;
}

export async function createSession(userId: string): Promise<void> {
  const token = await encryptSession({ userId }, secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
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
  if (!user) redirect("/login");
  return user;
}
