import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { resolveTerm } from "@/db/queries/stats";
import { classCatechists, classes, schoolYears, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { hashPassword } from "@/lib/auth/password";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8ByteLength } from "@/lib/auth/password-rules";
import { passwordChangeSecond } from "@/lib/auth/session-policy";
import { todayInVietnam } from "@/lib/dates";
import { recordAudit } from "../audit";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const password = z.string().min(PASSWORD_MIN_LENGTH, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
  .refine((value) => utf8ByteLength(value) <= PASSWORD_MAX_BYTES, `Mật khẩu tối đa ${PASSWORD_MAX_BYTES} byte`);
const DUPLICATE_CLASS = "Tên lớp đã tồn tại trong khối";
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const isHead = (user: AppUser): boolean => !user.isAdmin && user.isGradeHead && !!user.gradeId;

/** Reread the head under the same lock used for global account changes. */
async function currentHead(tx: Tx, user: AppUser) {
  if (!isHead(user)) return null;
  const [actor] = await tx.select().from(users).where(eq(users.id, user.id));
  if (!actor || !actor.isActive || actor.sessionVersion !== user.sessionVersion || actor.isAdmin || !actor.isGradeHead || !actor.gradeId || actor.gradeId !== user.gradeId) return null;
  return { ...actor, gradeId: actor.gradeId };
}

async function headMutation<T>(db: Db, user: AppUser, operation: (tx: Tx, actor: NonNullable<Awaited<ReturnType<typeof currentHead>>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  if (!isHead(user)) return fail(FORBIDDEN);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
      const actor = await currentHead(tx, user);
      return actor ? operation(tx, actor) : fail(FORBIDDEN);
    });
  } catch (error) {
    const codeOf = (value: unknown) => typeof value === "object" && value !== null ? (value as { code?: unknown }).code : undefined;
    const code = codeOf(error) ?? codeOf((error as { cause?: unknown } | null)?.cause);
    if (code === "23505") return fail(DUPLICATE_CLASS);
    console.error("grade administration failed", { code: typeof code === "string" ? code : "unknown" });
    return fail("Không lưu được thay đổi. Vui lòng thử lại");
  }
}

export async function createClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ name: z.string().trim().min(1, "Nhập tên lớp").max(60), schoolYearId: z.uuid("Năm học không hợp lệ").optional() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  return headMutation(db, user, async (tx, actor) => {
    const yearId = p.data.schoolYearId ?? (await resolveTerm(tx, undefined, todayInVietnam()))?.schoolYearId;
    if (!yearId) return fail("Chọn năm học trước khi tạo lớp");
    const [year] = await tx.select({ id: schoolYears.id, name: schoolYears.name }).from(schoolYears).where(eq(schoolYears.id, yearId));
    if (!year) return fail("Không tìm thấy năm học");
    const [duplicate] = await tx.select({ id: classes.id }).from(classes).where(and(eq(classes.gradeId, actor.gradeId), eq(classes.schoolYearId, year.id), eq(classes.name, p.data.name)));
    if (duplicate) return fail(DUPLICATE_CLASS);
    const [row] = await tx.insert(classes).values({ gradeId: actor.gradeId, schoolYearId: year.id, name: p.data.name }).returning({ id: classes.id });
    await recordAudit(tx, { actorId: actor.id, gradeId: actor.gradeId, entity: "class", entityId: row.id, action: "class.create", summary: { className: redactText(p.data.name), yearName: redactText(year.name) } });
    return ok({ id: row.id });
  });
}

export async function createCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ name: z.string().trim().min(1, "Nhập họ tên").max(120), email: z.string().trim().max(254).pipe(z.email("Email không hợp lệ")).transform((value) => value.toLowerCase()), password }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  return headMutation(db, user, async (tx, actor) => {
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, p.data.email));
    if (existing) return fail("Email đã được dùng");
    const [row] = await tx.insert(users).values({ name: p.data.name, email: p.data.email, gradeId: actor.gradeId, isGradeHead: false, isAdmin: false, passwordHash: await hashPassword(p.data.password) }).returning({ id: users.id });
    await recordAudit(tx, { actorId: actor.id, gradeId: actor.gradeId, entity: "account", entityId: row.id, action: "account.create", summary: { accountName: redactText(p.data.name), role: "catechist" } });
    return ok({ id: row.id });
  });
}

async function loadManaged(tx: Tx, actor: NonNullable<Awaited<ReturnType<typeof currentHead>>>, classId: string, userId: string, allowInactive = false) {
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(userId).success) return null;
  const cls = await getAccessClass(tx, classId);
  if (!cls || !canManageGrade(actor, cls.gradeId)) return null;
  const [target] = await tx.select().from(users).where(eq(users.id, userId));
  return target && !target.isAdmin && (target.isActive || allowInactive) && target.gradeId === cls.gradeId ? { cls, target } : null;
}

const assignInput = z.object({ classId: z.string(), userId: z.string() });
export async function assignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  return headMutation(db, user, async (tx, actor) => {
    const managed = await loadManaged(tx, actor, p.data.classId, p.data.userId);
    if (!managed) return fail(FORBIDDEN);
    const rows = await tx.insert(classCatechists).values(p.data).onConflictDoNothing().returning();
    if (rows.length > 0) await recordAudit(tx, { actorId: actor.id, classId: managed.cls.id, gradeId: actor.gradeId, entity: "account", entityId: managed.target.id, action: "account.assign", summary: { accountName: redactText(managed.target.name) } });
    return ok(undefined);
  });
}

export async function unassignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  return headMutation(db, user, async (tx, actor) => {
    const managed = await loadManaged(tx, actor, p.data.classId, p.data.userId, true);
    if (!managed) return fail(FORBIDDEN);
    const rows = await tx.delete(classCatechists).where(and(eq(classCatechists.classId, p.data.classId), eq(classCatechists.userId, p.data.userId))).returning();
    if (rows.length > 0) await recordAudit(tx, { actorId: actor.id, classId: managed.cls.id, gradeId: actor.gradeId, entity: "account", entityId: managed.target.id, action: "account.unassign", summary: { accountName: redactText(managed.target.name) } });
    return ok(undefined);
  });
}

/** Credential reset and admin promotion are serialized; revoke at the time the new hash is written. */
export async function resetPassword(db: Db, user: AppUser, input: unknown, now?: Date): Promise<ActionResult> {
  const p = z.object({ userId: z.string(), password }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!z.uuid().safeParse(p.data.userId).success) return fail(FORBIDDEN);
  return headMutation(db, user, async (tx, actor) => {
    const [target] = await tx.select().from(users).where(eq(users.id, p.data.userId));
    if (!target || target.gradeId !== actor.gradeId || target.isGradeHead || target.isAdmin) return fail(FORBIDDEN);
    const passwordHash = await hashPassword(p.data.password);
    await tx.update(users).set({ passwordHash, passwordChangedAt: passwordChangeSecond(now ?? new Date()), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, target.id));
    await recordAudit(tx, { actorId: actor.id, gradeId: actor.gradeId, entity: "account", entityId: target.id, action: "account.reset_credentials", summary: { accountName: redactText(target.name) } });
    return ok(undefined);
  });
}
