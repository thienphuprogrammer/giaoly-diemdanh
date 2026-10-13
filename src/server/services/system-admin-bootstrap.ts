import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "../../db/schema";
import type { Db } from "../../db/types";
import { hashPassword } from "../../lib/auth/password";
import { ADMIN_LOCK } from "../../lib/auth/admin-lock";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8ByteLength } from "../../lib/auth/password-rules";
import { passwordChangeSecond } from "../../lib/auth/session-policy";
import { redactText } from "../../lib/audit/events";
import { recordAudit } from "../audit";
import { fail, ok, type ActionResult } from "../result";

const inputSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email("Email không hợp lệ")).transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1, "Nhập tên admin").max(120),
  password: z.string().min(PASSWORD_MIN_LENGTH, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
    .refine((s) => utf8ByteLength(s) <= PASSWORD_MAX_BYTES, `Mật khẩu tối đa ${PASSWORD_MAX_BYTES} byte`).optional(),
  /** Explicit opt-in (`--promote-existing`) to turn an existing non-admin account into an admin (L2). Only `true` counts. */
  promoteExisting: z.literal(true).optional().catch(undefined),
});

export const PROMOTE_REFUSED = "Email này đã thuộc một tài khoản không phải admin. Kiểm tra lại email; nếu thật sự muốn nâng quyền tài khoản đó, chạy lại với --promote-existing";
const AMBIGUOUS_EMAIL = "Có nhiều tài khoản trùng email này (khác chữ hoa/thường). Hãy gộp hoặc sửa email trước khi tạo admin";

/**
 * Operator-only bootstrap: existing credentials are preserved unless a new password is explicitly supplied.
 * The email is matched case-insensitively (L3); an existing non-admin account is only promoted with `promoteExisting: true` (L2),
 * and a promoted row's email is normalized to the lower-case address that login uses.
 */
export async function bootstrapAdmin(db: Db, input: unknown, now?: Date): Promise<ActionResult<{ id: string; email: string; created: boolean; credentialsChanged: boolean }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
      const matches = await tx.select().from(users).where(sql`lower(${users.email}) = ${parsed.data.email}`);
      if (matches.length > 1) return fail(AMBIGUOUS_EMAIL);
      const [existing] = matches;
      if (!existing && !parsed.data.password) return fail("Cần đặt mật khẩu cho tài khoản admin mới");
      if (existing) {
        if (!existing.isAdmin && parsed.data.promoteExisting !== true) return fail(PROMOTE_REFUSED);
        const changed = !existing.isAdmin || !existing.isActive || existing.isGradeHead || existing.gradeId !== null || existing.name !== parsed.data.name || existing.email !== parsed.data.email || !!parsed.data.password;
        if (changed) {
          const newHash = parsed.data.password ? await hashPassword(parsed.data.password) : undefined;
          const privilegeChanged = !existing.isAdmin || !existing.isActive || existing.isGradeHead || existing.gradeId !== null;
          const revocation = newHash || privilegeChanged ? { passwordChangedAt: passwordChangeSecond(now ?? new Date()), sessionVersion: sql`${users.sessionVersion} + 1` } : {};
          const credentials = { ...(newHash ? { passwordHash: newHash } : {}), ...revocation };
          await tx.update(users).set({ name: parsed.data.name, email: parsed.data.email, isAdmin: true, isActive: true, isGradeHead: false, gradeId: null, ...credentials }).where(eq(users.id, existing.id));
          await recordAudit(tx, { actorId: existing.id, entity: "account", entityId: existing.id, action: "account.update", summary: { accountName: redactText(parsed.data.name), role: "admin", bootstrap: true } });
          if (parsed.data.password) await recordAudit(tx, { actorId: existing.id, entity: "account", entityId: existing.id, action: "account.reset_credentials", summary: { accountName: redactText(parsed.data.name), bootstrap: true } });
        }
        return ok({ id: existing.id, email: parsed.data.email, created: false, credentialsChanged: !!parsed.data.password });
      }
      const [created] = await tx.insert(users).values({ email: parsed.data.email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password!), isAdmin: true }).returning({ id: users.id });
      await recordAudit(tx, { actorId: created.id, entity: "account", entityId: created.id, action: "account.create", summary: { accountName: redactText(parsed.data.name), role: "admin", bootstrap: true } });
      return ok({ id: created.id, email: parsed.data.email, created: true, credentialsChanged: true });
    });
  } catch {
    // Errors may contain connection strings, query parameters or hashes. Print only this bounded message.
    return fail("Không tạo được admin. Kiểm tra kết nối và đã chạy migration mới nhất");
  }
}

