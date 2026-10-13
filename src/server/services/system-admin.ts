import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { auditEvents, classCatechists, classMemberships, classes, grades, promotions, schoolYears, seatingPlans, sessions, students, users } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { redactText } from "@/lib/audit/events";
import { hashPassword } from "@/lib/auth/password";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, utf8ByteLength } from "@/lib/auth/password-rules";
import { passwordChangeSecond } from "@/lib/auth/session-policy";
import { currentPasswordOf, verifyStepUp } from "@/lib/auth/step-up";
import { recordAudit } from "../audit";
import { fail, ok, type ActionResult } from "../result";
import { resolveSchoolYearForUser } from "./school-years";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const NOT_FOUND = "Không tìm thấy dữ liệu cần quản lý";
const SELF_RESET = "Hãy đổi mật khẩu của chính bạn ở trang Tài khoản";
const STEP_UP_ERRORS = {
  missing: "Nhập mật khẩu của bạn để xác nhận thao tác này",
  wrong: "Mật khẩu của bạn không đúng",
  locked: "Nhập sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.",
} as const;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const id = z.uuid("Mã dữ liệu không hợp lệ");
const name = z.string().trim().min(1, "Nhập họ tên").max(120, "Họ tên tối đa 120 ký tự");
const email = z.string().trim().max(254, "Email quá dài").pipe(z.email("Email không hợp lệ")).transform((s) => s.toLowerCase());
const password = z.string().min(PASSWORD_MIN_LENGTH, `Mật khẩu phải có ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
  .refine((s) => utf8ByteLength(s) <= PASSWORD_MAX_BYTES, `Mật khẩu tối đa ${PASSWORD_MAX_BYTES} byte (chữ có dấu tính 2–3 byte)`);
const role = z.enum(["admin", "head", "catechist"], { error: "Vai trò không hợp lệ" });
export type SystemRole = z.infer<typeof role>;
const accountFields = z.object({ name, email, role, gradeId: id.nullable().optional() })
  .refine((v) => v.role !== "head" || !!v.gradeId, "Chọn khối cho khối trưởng");
const accountCreate = accountFields.safeExtend({ password });
const accountUpdate = accountFields.safeExtend({ userId: id });
const className = z.string().trim().min(1, "Nhập tên lớp").max(60, "Tên lớp tối đa 60 ký tự");
const gradeName = z.string().trim().min(1, "Nhập tên khối").max(60, "Tên khối tối đa 60 ký tự");
const threshold = z.number().int().min(1, "Ngưỡng cảnh báo phải từ 1").max(52, "Ngưỡng cảnh báo tối đa 52");
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

export interface SystemAccount {
  id: string; name: string; email: string; role: SystemRole;
  isAdmin: boolean; isGradeHead: boolean; isActive: boolean; gradeId: string | null; gradeName: string | null;
  assignedClasses: { id: string; name: string; gradeId: string; schoolYearId: string }[];
}
export interface SystemAdminOverview {
  accounts: SystemAccount[];
  accountChoices: { id: string; name: string; email: string; isActive: boolean; role: SystemRole }[];
  grades: { id: string; name: string; massThreshold: number; nextGradeId: string | null; classCount: number; accountCount: number }[];
  schoolYears: { id: string; name: string; classCount: number }[];
  classes: {
    id: string; name: string; gradeId: string; gradeName: string; schoolYearId: string; schoolYearName: string;
    studentCount: number; catechists: { id: string; name: string; email: string }[];
  }[];
  selectedSchoolYearId: string | null;
  counts: { accounts: number; activeAccounts: number; admins: number; gradeHeads: number; grades: number; classes: number; students: number };
}

async function isStoredAdmin(db: Db | Tx, user: AppUser): Promise<boolean> {
  if (!user.isAdmin) return false;
  const [actor] = await db.select({ isAdmin: users.isAdmin, isActive: users.isActive, version: users.sessionVersion }).from(users).where(eq(users.id, user.id));
  return actor?.isAdmin === true && actor.isActive === true && actor.version === user.sessionVersion;
}

/** Serialize administrative changes, then reread the actor to close the stale-session race. */
async function mutate<T>(db: Db, user: AppUser, operation: (tx: Tx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
      if (!(await isStoredAdmin(tx, user))) return fail(FORBIDDEN);
      return operation(tx);
    });
  } catch (error) {
    const codeOf = (e: unknown): unknown => typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
    const code = codeOf(error) ?? codeOf((error as { cause?: unknown } | null)?.cause);
    if (code === "23505") return fail("Tên hoặc email đã được dùng");
    if (code === "23503") return fail("Dữ liệu đang được sử dụng, không thể thay đổi hoặc xoá");
    // Database driver errors may contain SQL parameters, including credential hashes. Never log the raw error.
    console.error("system admin operation failed", { code: typeof code === "string" ? code : "unknown" });
    return fail("Không lưu được thay đổi. Vui lòng thử lại");
  }
}

/**
 * Step-up for credential resets and admin-privilege changes (M1): a stolen admin session alone must not be enough to take
 * over or lock out another administrator. Returns a failure to send back (the transaction still commits the attempt), or null.
 */
async function stepUpFailure(tx: Tx, user: AppUser, input: unknown, now?: Date): Promise<ActionResult<never> | null> {
  const result = await verifyStepUp(tx, user.id, currentPasswordOf(input), now ?? new Date());
  return result === "ok" ? null : fail(STEP_UP_ERRORS[result]);
}

const roleOf = (u: { isAdmin: boolean; isGradeHead: boolean }): SystemRole => u.isAdmin ? "admin" : u.isGradeHead ? "head" : "catechist";
const roleValues = (v: { role: SystemRole; gradeId?: string | null }) => ({
  isAdmin: v.role === "admin", isGradeHead: v.role === "head", gradeId: v.role === "admin" ? null : v.gradeId ?? null,
});
const countBy = <T>(rows: T[], match: (row: T) => boolean) => rows.filter(match).length;

/** Explicit safe projection: account credentials and session-revocation timestamps never leave this service. */
export async function getSystemAdminOverview(
  db: Db, user: AppUser, input: { schoolYearId?: string; gradeId?: string; query?: string } = {},
): Promise<ActionResult<SystemAdminOverview>> {
  if (!(await isStoredAdmin(db, user))) return fail(FORBIDDEN);
  const parsed = z.object({ schoolYearId: id.optional(), gradeId: id.optional(), query: z.string().trim().max(120).optional() }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  const [allAccounts, allGrades, allYears, allClasses, assignments, roster, selected] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, isAdmin: users.isAdmin, isGradeHead: users.isGradeHead, isActive: users.isActive, gradeId: users.gradeId }).from(users).orderBy(asc(users.name)),
    db.select().from(grades).orderBy(asc(grades.name)),
    db.select({ id: schoolYears.id, name: schoolYears.name }).from(schoolYears).orderBy(asc(schoolYears.name)),
    db.select().from(classes).orderBy(asc(classes.name)),
    db.select().from(classCatechists),
    db.select({ classId: students.classId }).from(students).where(eq(students.active, true)),
    resolveSchoolYearForUser(db, user, parsed.data.schoolYearId),
  ]);
  if (parsed.data.schoolYearId && !allYears.some((y) => y.id === parsed.data.schoolYearId)) return fail(NOT_FOUND);
  if (parsed.data.gradeId && !allGrades.some((g) => g.id === parsed.data.gradeId)) return fail(NOT_FOUND);
  const needle = parsed.data.query?.toLocaleLowerCase("vi") ?? "";
  const matches = (...values: (string | null)[]) => !needle || values.some((v) => v?.toLocaleLowerCase("vi").includes(needle));
  const gradeMap = new Map(allGrades.map((g) => [g.id, g.name]));
  const yearMap = new Map(allYears.map((y) => [y.id, y.name]));
  const accountMap = new Map(allAccounts.map((a) => [a.id, a]));
  const shownClasses = allClasses.filter((c) => (!selected || c.schoolYearId === selected.id) && (!parsed.data.gradeId || c.gradeId === parsed.data.gradeId) && matches(c.name, gradeMap.get(c.gradeId) ?? null));
  return ok({
    accountChoices: allAccounts.map((a) => ({ id: a.id, name: a.name, email: a.email, isActive: a.isActive, role: roleOf(a) })),
    accounts: allAccounts.filter((a) => (!parsed.data.gradeId || a.gradeId === parsed.data.gradeId) && matches(a.name, a.email)).map((a) => ({
      ...a, role: roleOf(a), gradeName: a.gradeId ? gradeMap.get(a.gradeId) ?? null : null,
      assignedClasses: allClasses.filter((c) => assignments.some((m) => m.userId === a.id && m.classId === c.id)).map((c) => ({ id: c.id, name: c.name, gradeId: c.gradeId, schoolYearId: c.schoolYearId })),
    })),
    grades: allGrades.map((g) => ({ ...g, classCount: countBy(allClasses, (c) => c.gradeId === g.id), accountCount: countBy(allAccounts, (a) => a.gradeId === g.id) })),
    schoolYears: allYears.map((y) => ({ ...y, classCount: countBy(allClasses, (c) => c.schoolYearId === y.id) })),
    classes: shownClasses.map((c) => ({
      id: c.id, name: c.name, gradeId: c.gradeId, gradeName: gradeMap.get(c.gradeId) ?? "", schoolYearId: c.schoolYearId,
      schoolYearName: yearMap.get(c.schoolYearId) ?? "", studentCount: countBy(roster, (s) => s.classId === c.id),
      catechists: assignments.filter((m) => m.classId === c.id).flatMap((m) => {
        const a = accountMap.get(m.userId); return a ? [{ id: a.id, name: a.name, email: a.email }] : [];
      }),
    })),
    selectedSchoolYearId: selected?.id ?? null,
    counts: { accounts: allAccounts.length, activeAccounts: countBy(allAccounts, (a) => a.isActive), admins: countBy(allAccounts, (a) => a.isAdmin && a.isActive), gradeHeads: countBy(allAccounts, (a) => a.isGradeHead), grades: allGrades.length, classes: shownClasses.length, students: countBy(roster, (s) => shownClasses.some((c) => c.id === s.classId)) },
  });
}

async function gradeExists(db: Db | Tx, gradeId: string | null): Promise<boolean> {
  return gradeId === null || (await db.select({ id: grades.id }).from(grades).where(eq(grades.id, gradeId))).length > 0;
}

/** Creating an administrator requires the acting admin's current password (`currentPassword`). */
export async function createAccount(db: Db, user: AppUser, input: unknown, now?: Date): Promise<ActionResult<{ id: string }>> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = accountCreate.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const values = roleValues(parsed.data);
    if (!(await gradeExists(tx, values.gradeId))) return fail("Không tìm thấy khối");
    if (values.isAdmin) {
      const denied = await stepUpFailure(tx, user, input, now);
      if (denied) return denied;
    }
    const [account] = await tx.insert(users).values({ name: parsed.data.name, email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password), ...values }).returning({ id: users.id });
    await recordAudit(tx, { actorId: user.id, entity: "account", entityId: account.id, action: "account.create", summary: { accountName: redactText(parsed.data.name), role: parsed.data.role } });
    return ok({ id: account.id });
  });
}

async function removalOfLastAdmin(tx: Tx, target: typeof users.$inferSelect, willRemainAdmin: boolean): Promise<boolean> {
  if (!target.isAdmin || !target.isActive || willRemainAdmin) return false;
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.isAdmin, true), eq(users.isActive, true)));
  return Number(count.n) <= 1;
}

/** Granting admin, or changing another administrator's account, requires the acting admin's current password. */
export async function updateAccount(db: Db, user: AppUser, input: unknown, now?: Date): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = accountUpdate.safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, parsed.data.userId));
    if (!target) return fail(NOT_FOUND);
    const values = roleValues(parsed.data);
    if (target.id === user.id && !values.isAdmin) return fail("Bạn không thể hạ quyền quản trị của chính mình");
    if (await removalOfLastAdmin(tx, target, values.isAdmin && target.isActive)) return fail("Hệ thống cần ít nhất một admin đang hoạt động");
    if (!(await gradeExists(tx, values.gradeId))) return fail("Không tìm thấy khối");
    if (target.name === parsed.data.name && target.email === parsed.data.email && target.gradeId === values.gradeId && target.isGradeHead === values.isGradeHead && target.isAdmin === values.isAdmin) return ok(undefined);
    if (target.id !== user.id && (target.isAdmin || values.isAdmin)) {
      const denied = await stepUpFailure(tx, user, input, now);
      if (denied) return denied;
    }
    const privilegeChanged = target.gradeId !== values.gradeId || target.isGradeHead !== values.isGradeHead || target.isAdmin !== values.isAdmin;
    const revocation = privilegeChanged ? { passwordChangedAt: passwordChangeSecond(new Date()), sessionVersion: sql`${users.sessionVersion} + 1` } : {};
    await tx.update(users).set({ name: parsed.data.name, email: parsed.data.email, ...values, ...revocation }).where(eq(users.id, target.id));
    await recordAudit(tx, { actorId: user.id, entity: "account", entityId: target.id, action: "account.update", summary: { accountName: redactText(parsed.data.name), before: { role: roleOf(target), gradeId: target.gradeId }, after: { role: parsed.data.role, gradeId: values.gradeId } } });
    return ok(undefined);
  });
}

/** Locking or unlocking another administrator requires the acting admin's current password. */
export async function setAccountActive(db: Db, user: AppUser, input: unknown, now?: Date): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ userId: id, isActive: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, parsed.data.userId));
    if (!target) return fail(NOT_FOUND);
    if (target.id === user.id && !parsed.data.isActive) return fail("Bạn không thể khoá tài khoản của chính mình");
    if (await removalOfLastAdmin(tx, target, target.isAdmin && parsed.data.isActive)) return fail("Hệ thống cần ít nhất một admin đang hoạt động");
    if (target.isActive === parsed.data.isActive) return ok(undefined);
    if (target.isAdmin) {
      const denied = await stepUpFailure(tx, user, input, now);
      if (denied) return denied;
    }
    // Revocation remains in place after reactivation: old cookies must not come back to life.
    await tx.update(users).set({ isActive: parsed.data.isActive, passwordChangedAt: passwordChangeSecond(now ?? new Date()), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, target.id));
    await recordAudit(tx, { actorId: user.id, entity: "account", entityId: target.id, action: parsed.data.isActive ? "account.activate" : "account.deactivate", summary: { accountName: redactText(target.name) } });
    return ok(undefined);
  });
}

/**
 * Resets another account's password. Always requires the acting admin's current password; an admin's own password can
 * only be changed through self-service change-password (which checks the current password), never through this path.
 */
export async function resetAccountPassword(db: Db, user: AppUser, input: unknown, now?: Date): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ userId: id, password }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  if (parsed.data.userId === user.id) return fail(SELF_RESET);
  return mutate(db, user, async (tx) => {
    const [target] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, parsed.data.userId));
    if (!target) return fail(NOT_FOUND);
    const denied = await stepUpFailure(tx, user, input, now);
    if (denied) return denied;
    const passwordHash = await hashPassword(parsed.data.password);
    await tx.update(users).set({ passwordHash, passwordChangedAt: passwordChangeSecond(now ?? new Date()), sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, target.id));
    await recordAudit(tx, { actorId: user.id, entity: "account", entityId: target.id, action: "account.reset_credentials", summary: { accountName: redactText(target.name) } });
    return ok(undefined);
  });
}

export async function createGrade(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ name: gradeName, massThreshold: threshold.default(2) }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [grade] = await tx.insert(grades).values(parsed.data).returning({ id: grades.id });
    await recordAudit(tx, { actorId: user.id, entity: "grade", entityId: grade.id, action: "grade.create", summary: { gradeName: redactText(parsed.data.name) } });
    return ok({ id: grade.id });
  });
}

export async function updateGrade(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ gradeId: id, name: gradeName, massThreshold: threshold, nextGradeId: id.nullable().optional() }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [grade] = await tx.select().from(grades).where(eq(grades.id, parsed.data.gradeId));
    if (!grade) return fail(NOT_FOUND);
    const nextGradeId = parsed.data.nextGradeId === undefined ? grade.nextGradeId : parsed.data.nextGradeId;
    if (nextGradeId === grade.id) return fail("Khối kế tiếp phải khác khối hiện tại");
    if (!(await gradeExists(tx, nextGradeId))) return fail("Không tìm thấy khối kế tiếp");
    if (grade.name === parsed.data.name && grade.massThreshold === parsed.data.massThreshold && grade.nextGradeId === nextGradeId) return ok(undefined);
    await tx.update(grades).set({ name: parsed.data.name, massThreshold: parsed.data.massThreshold, nextGradeId }).where(eq(grades.id, grade.id));
    await recordAudit(tx, { actorId: user.id, entity: "grade", entityId: grade.id, action: "grade.update", summary: { gradeName: redactText(parsed.data.name), before: { name: redactText(grade.name), massThreshold: grade.massThreshold, nextGradeId: grade.nextGradeId }, after: { name: redactText(parsed.data.name), massThreshold: parsed.data.massThreshold, nextGradeId } } });
    return ok(undefined);
  });
}

export async function deleteGrade(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ gradeId: id }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [grade] = await tx.select().from(grades).where(eq(grades.id, parsed.data.gradeId)).for("update");
    if (!grade) return fail(NOT_FOUND);
    const [linkedClasses, linkedUsers, linkedGrades, linkedAudits] = await Promise.all([
      tx.select({ id: classes.id }).from(classes).where(eq(classes.gradeId, grade.id)).limit(1),
      tx.select({ id: users.id }).from(users).where(eq(users.gradeId, grade.id)).limit(1),
      tx.select({ id: grades.id }).from(grades).where(eq(grades.nextGradeId, grade.id)).limit(1),
      tx.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.gradeId, grade.id)).limit(1),
    ]);
    if ([linkedClasses, linkedUsers, linkedGrades, linkedAudits].some((r) => r.length > 0)) return fail("Khối đã có lớp, tài khoản hoặc lịch sử. Hãy giữ lại dữ liệu này");
    await tx.delete(grades).where(eq(grades.id, grade.id));
    await recordAudit(tx, { actorId: user.id, entity: "grade", entityId: grade.id, action: "grade.delete", summary: { gradeName: redactText(grade.name) } });
    return ok(undefined);
  });
}

export async function createSystemClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ name: className, gradeId: id, schoolYearId: id }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    if (!(await gradeExists(tx, parsed.data.gradeId))) return fail("Không tìm thấy khối");
    const [year] = await tx.select({ name: schoolYears.name }).from(schoolYears).where(eq(schoolYears.id, parsed.data.schoolYearId));
    if (!year) return fail("Không tìm thấy năm học");
    const [cls] = await tx.insert(classes).values(parsed.data).returning({ id: classes.id });
    await recordAudit(tx, { actorId: user.id, gradeId: parsed.data.gradeId, entity: "class", entityId: cls.id, action: "class.create", summary: { className: redactText(parsed.data.name), yearName: redactText(year.name) } });
    return ok({ id: cls.id });
  });
}

export async function updateSystemClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ classId: id, name: className, gradeId: id }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [cls] = await tx.select().from(classes).where(eq(classes.id, parsed.data.classId));
    if (!cls) return fail(NOT_FOUND);
    if (!(await gradeExists(tx, parsed.data.gradeId))) return fail("Không tìm thấy khối");
    if (cls.name === parsed.data.name && cls.gradeId === parsed.data.gradeId) return ok(undefined);
    await tx.update(classes).set({ name: parsed.data.name, gradeId: parsed.data.gradeId }).where(eq(classes.id, cls.id));
    await recordAudit(tx, { actorId: user.id, gradeId: parsed.data.gradeId, entity: "class", entityId: cls.id, action: "class.update", summary: { className: redactText(parsed.data.name), before: { name: redactText(cls.name), gradeId: cls.gradeId }, after: { name: redactText(parsed.data.name), gradeId: parsed.data.gradeId } } });
    return ok(undefined);
  });
}

export async function deleteSystemClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ classId: id }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    // Row lock blocks concurrent child insertions (FK KEY SHARE) while references are checked.
    const [cls] = await tx.select().from(classes).where(eq(classes.id, parsed.data.classId)).for("update");
    if (!cls) return fail(NOT_FOUND);
    const refs = await Promise.all([
      tx.select({ id: students.id }).from(students).where(eq(students.classId, cls.id)).limit(1),
      tx.select({ id: classMemberships.studentId }).from(classMemberships).where(eq(classMemberships.classId, cls.id)).limit(1),
      tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.classId, cls.id)).limit(1),
      tx.select({ id: seatingPlans.id }).from(seatingPlans).where(eq(seatingPlans.classId, cls.id)).limit(1),
      tx.select({ id: classCatechists.userId }).from(classCatechists).where(eq(classCatechists.classId, cls.id)).limit(1),
      tx.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.classId, cls.id)).limit(1),
      tx.select({ id: promotions.id }).from(promotions).where(or(eq(promotions.fromClassId, cls.id), eq(promotions.toClassId, cls.id))).limit(1),
    ]);
    if (refs.some((r) => r.length > 0)) return fail("Lớp đã có phân công, thiếu nhi hoặc lịch sử. Hãy giữ lại dữ liệu này");
    await tx.delete(classes).where(eq(classes.id, cls.id));
    await recordAudit(tx, { actorId: user.id, gradeId: cls.gradeId, entity: "class", entityId: cls.id, action: "class.delete", summary: { className: redactText(cls.name) } });
    return ok(undefined);
  });
}

async function changeAssignment(db: Db, user: AppUser, input: unknown, assign: boolean): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const parsed = z.object({ classId: id, userId: id }).safeParse(input);
  if (!parsed.success) return fail(firstError(parsed.error));
  return mutate(db, user, async (tx) => {
    const [cls] = await tx.select().from(classes).where(eq(classes.id, parsed.data.classId));
    const [target] = await tx.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users).where(eq(users.id, parsed.data.userId));
    if (!cls || !target) return fail(NOT_FOUND);
    if (assign && !target.isActive) return fail("Mở khoá tài khoản trước khi phân công");
    const where = and(eq(classCatechists.classId, cls.id), eq(classCatechists.userId, target.id));
    const changed = assign
      ? await tx.insert(classCatechists).values(parsed.data).onConflictDoNothing().returning()
      : await tx.delete(classCatechists).where(where).returning();
    if (changed.length === 0) return ok(undefined);
    await recordAudit(tx, { actorId: user.id, classId: cls.id, gradeId: cls.gradeId, entity: "account", entityId: target.id, action: assign ? "account.assign" : "account.unassign", summary: { accountName: redactText(target.name), className: redactText(cls.name) } });
    return ok(undefined);
  });
}
export const assignAccountToClass = (db: Db, user: AppUser, input: unknown): Promise<ActionResult> => changeAssignment(db, user, input, true);
export const unassignAccountFromClass = (db: Db, user: AppUser, input: unknown): Promise<ActionResult> => changeAssignment(db, user, input, false);
