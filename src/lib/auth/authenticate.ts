import { and, eq, gt } from "drizzle-orm";
import { loginAttempts, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { DUMMY_HASH, verifyPassword } from "./password";
import { WINDOW_MS, isLockedOut } from "./rate-limit";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticate(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const recent = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), gt(loginAttempts.attemptedAt, new Date(now.getTime() - WINDOW_MS))));
  if (isLockedOut(recent.map((r) => r.at), now)) return { ok: false, reason: "locked" };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) {
    await db.insert(loginAttempts).values({ email, attemptedAt: now });
    return { ok: false, reason: "invalid" };
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
  return { ok: true, userId: user.id };
}
