import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { accountAttemptKey, clearPasswordAttempts, recordPasswordAttempt } from "@/lib/auth/attempts";
import { DUMMY_HASH, hashPassword, verifyPassword } from "@/lib/auth/password";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8ByteLength } from "@/lib/auth/password-rules";
import { passwordChangeSecond } from "@/lib/auth/session-policy";
import type { RateLimiter } from "@/lib/rate-limit";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { redactText } from "@/lib/audit/events";
import { recordAudit } from "../audit";

export type ChangePasswordField = "currentPassword" | "newPassword" | "confirmPassword";
export type ChangePasswordResult =
  | { ok: true; changedAt: Date; sessionVersion: number }
  | { ok: false; error: string; field: ChangePasswordField | null };

/** Trạng thái form đổi mật khẩu (useActionState). */
export type ChangePasswordState = { ok?: boolean; error?: string; field?: ChangePasswordField | null } | undefined;

const WRONG_CURRENT = "Mật khẩu hiện tại không đúng";
const TOO_SHORT = `Mật khẩu mới phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`;
const LOCKED = "Nhập sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.";
const RATE_LIMITED = "Thao tác quá nhanh, vui lòng thử lại sau ít phút";
const SAVE_FAILED = "Không đổi được mật khẩu. Vui lòng thử lại";

const schema = z
  .object({
    // Mật khẩu hiện tại chỉ để so với hash; chặn chuỗi quá dài để không tốn công băm vô ích.
    currentPassword: z.string({ error: "Nhập mật khẩu hiện tại" }).min(1, "Nhập mật khẩu hiện tại").max(1024, WRONG_CURRENT),
    newPassword: z
      .string({ error: TOO_SHORT })
      .min(PASSWORD_MIN_LENGTH, TOO_SHORT)
      .refine((s) => utf8ByteLength(s) <= PASSWORD_MAX_BYTES, `Mật khẩu mới quá dài (tối đa ${PASSWORD_MAX_BYTES} byte; chữ có dấu tính 2–3 byte)`),
    confirmPassword: z.string({ error: "Mật khẩu xác nhận không khớp" }),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword === v.currentPassword) ctx.addIssue({ code: "custom", path: ["newPassword"], message: "Mật khẩu mới phải khác mật khẩu hiện tại" });
    else if (v.confirmPassword !== v.newPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "Mật khẩu xác nhận không khớp" });
  });

const FIELDS: readonly ChangePasswordField[] = ["currentPassword", "newPassword", "confirmPassword"];
const fieldOf = (path: readonly PropertyKey[]): ChangePasswordField | null =>
  FIELDS.find((f) => f === path[0]) ?? null;
const failure = (error: string, field: ChangePasswordField | null): ChangePasswordResult => ({ ok: false, error, field });

/**
 * Người dùng tự đổi mật khẩu. KHÔNG bao giờ ghi/ trả lại mật khẩu hay hash.
 * - Kiểm dữ liệu trước (không tính lượt sai). Mật khẩu hiện tại sai được ghi vào bộ đếm RIÊNG theo user id
 *   (`accountAttemptKey`, dùng chung với bước xác nhận mật khẩu của admin), không phải bộ đếm đăng nhập theo email:
 *   người ngoài đoán sai mật khẩu đăng nhập không thể chặn người dùng đổi mật khẩu (M2). 5 lượt / 15 phút thì khóa;
 *   nhập đúng chỉ xóa bộ đếm này.
 * - Thành công: một câu UPDATE đặt hash mới và `password_changed_at` = bây giờ (cắt về giây) → mọi phiên đăng nhập
 *   trước đó bị DAL từ chối; action cấp lại phiên cho chính thiết bị này (`sat` = bây giờ ≥ mốc đổi).
 *   Ghi nhật ký `account.change_password` (chỉ tên tài khoản) trong cùng transaction (L4); lỗi ghi nhật ký thì rollback.
 */
export async function changePassword(
  db: Db, user: AppUser, input: unknown, deps: { limiter?: RateLimiter; now?: Date } = {},
): Promise<ChangePasswordResult> {
  if (deps.limiter && !deps.limiter.hit(user.id).allowed) return failure(RATE_LIMITED, null);
  const p = schema.safeParse(input);
  if (!p.success) {
    const issue = p.error.issues[0];
    return failure(issue?.message ?? "Dữ liệu không hợp lệ", issue ? fieldOf(issue.path) : null);
  }
  const attemptKey = accountAttemptKey(user.id);
  try {
    return await db.transaction(async (tx): Promise<ChangePasswordResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
      if ((await recordPasswordAttempt(tx, attemptKey, deps.now ?? new Date())).locked) return failure(LOCKED, null);
      const [row] = await tx.select({ id: users.id, name: users.name, passwordHash: users.passwordHash, isActive: users.isActive, sessionVersion: users.sessionVersion }).from(users).where(eq(users.id, user.id));
      const valid = await verifyPassword(p.data.currentPassword, row?.passwordHash ?? DUMMY_HASH);
      if (!row || !row.isActive || row.sessionVersion !== user.sessionVersion || !valid) return failure(WRONG_CURRENT, "currentPassword");
      const passwordHash = await hashPassword(p.data.newPassword);
      const changedAt = passwordChangeSecond(deps.now ?? new Date());
      const [updated] = await tx.update(users).set({ passwordHash, passwordChangedAt: changedAt, sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, row.id)).returning({ sessionVersion: users.sessionVersion });
      await clearPasswordAttempts(tx, attemptKey);
      await recordAudit(tx, { actorId: row.id, entity: "account", entityId: row.id, action: "account.change_password", summary: { accountName: redactText(row.name) } });
      return { ok: true, changedAt, sessionVersion: updated.sessionVersion };
    });
  } catch (error) {
    // Driver errors may carry SQL parameters (the new hash). Log only the error code.
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    console.error("change password failed", { code: typeof code === "string" ? code : "unknown" });
    return failure(SAVE_FAILED, null);
  }
}
