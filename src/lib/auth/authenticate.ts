import { and, eq, gt, lte } from "drizzle-orm";
import { loginAttempts, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { DUMMY_HASH, verifyPassword } from "./password";
import { MAX_ATTEMPTS, WINDOW_MS, isLockedOut } from "./rate-limit";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticate(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const since = new Date(now.getTime() - WINDOW_MS);

  // Ghi nhận lượt thử TRƯỚC rồi mới đếm: các request song song không thể lách giới hạn.
  await db.delete(loginAttempts).where(and(eq(loginAttempts.email, email), lte(loginAttempts.attemptedAt, since)));
  await db.insert(loginAttempts).values({ email, attemptedAt: now });
  const recent = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, since)));
  // Lượt hiện tại đã nằm trong số đếm nên khóa khi vượt quá MAX_ATTEMPTS.
  if (isLockedOut(recent.map((r) => r.at), now, MAX_ATTEMPTS + 1)) return { ok: false, reason: "locked" };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) return { ok: false, reason: "invalid" };
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  return { ok: true, userId: user.id };
}
