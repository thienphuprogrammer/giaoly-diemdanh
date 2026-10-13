import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import { clearPasswordAttempts, recordPasswordAttempt } from "./attempts";
import { DUMMY_HASH, verifyPassword } from "./password";

export type AuthResult =
  | { ok: true; userId: string; sessionVersion: number }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticate(
  db: Db,
  input: { email: string; password: string },
  now: Date = new Date(),
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  if ((await recordPasswordAttempt(db, email, now)).locked) return { ok: false, reason: "locked" };

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.isActive) return { ok: false, reason: "invalid" };
  await clearPasswordAttempts(db, email);
  return { ok: true, userId: user.id, sessionVersion: user.sessionVersion };
}
