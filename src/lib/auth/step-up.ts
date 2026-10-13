import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import { accountAttemptKey, clearPasswordAttempts, recordPasswordAttempt } from "./attempts";
import { DUMMY_HASH, verifyPassword } from "./password";

export type StepUpResult = "ok" | "missing" | "wrong" | "locked";

/** Upper bound for a password that is only compared with a hash: avoid hashing arbitrarily long strings. */
const MAX_INPUT = 1024;

/** Reads `currentPassword` from untrusted service input without trusting its shape. */
export function currentPasswordOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const value = (input as { currentPassword?: unknown }).currentPassword;
  return typeof value === "string" ? value : "";
}

/**
 * Step-up re-authentication of an already signed-in user (M1). An empty value is a validation error and is not counted.
 * Otherwise the attempt is recorded first under the user-id key shared with self-service change-password (5 per 15 minutes),
 * then the password is checked with bcrypt; success clears only that key. Call inside the caller's transaction and let it
 * COMMIT on failure (return a result, do not throw) so failed attempts persist.
 */
export async function verifyStepUp(tx: Db, userId: string, password: string, now: Date): Promise<StepUpResult> {
  if (!password) return "missing";
  const key = accountAttemptKey(userId);
  if ((await recordPasswordAttempt(tx, key, now)).locked) return "locked";
  const [row] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  const valid = password.length <= MAX_INPUT && await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
  if (!row || !valid) return "wrong";
  await clearPasswordAttempts(tx, key);
  return "ok";
}
