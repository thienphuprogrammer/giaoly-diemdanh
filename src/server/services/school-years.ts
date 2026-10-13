import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classes, schoolYears, sessions, terms, users } from "@/db/schema";
import { listClassesForUser } from "@/db/queries/classes";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { START_WINDOW, startWindow, suggestSchoolYear, termsOverlap, validateTermRanges, type SchoolYearDraft, type TermInput } from "@/lib/school-year/defaults";
import type { AuditEvent } from "../audit";
import { recordAudit } from "../audit";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const BAD_DATE = "Ngày không hợp lệ";
/** Khoá tư vấn giữ trong transaction: hai lần tạo năm học cùng lúc chạy lần lượt (kiểm tra trùng tên/trùng ngày không bị đua). */
const YEAR_LOCK = 3_607_001;

const day = z.iso.date(BAD_DATE).refine((d) => d >= "2000-01-01" && d <= "2100-12-31", BAD_DATE);
const termSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên học kỳ").max(40, "Tên học kỳ tối đa 40 ký tự"),
  startsOn: day,
  endsOn: day,
});
const yearSchema = z.object({
  name: z.string().trim().min(1, "Nhập tên năm học").max(40, "Tên năm học tối đa 40 ký tự"),
  term1: termSchema,
  term2: termSchema,
}, { error: "Dữ liệu không hợp lệ" });

const canManageYears = (user: AppUser): boolean => user.isAdmin || (user.isGradeHead && !!user.gradeId);
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");

export interface SchoolYearSummary {
  id: string;
  name: string;
  terms: { id: string; name: string; startsOn: string; endsOn: string }[];
  /** Chưa có lớp hoặc buổi điểm danh thuộc năm: xoá được. */
  deletable: boolean;
}

type Reader = Pick<Db, "select" | "selectDistinct">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Privilege changes and year changes share lock order; a queued request cannot reuse revoked rights. */
async function currentYearManager(tx: Tx, user: AppUser, adminOnly = false): Promise<AppUser | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
  const [actor] = await tx.select().from(users).where(eq(users.id, user.id));
  if (!actor || !actor.isActive || actor.sessionVersion !== user.sessionVersion || actor.isAdmin !== user.isAdmin || actor.isGradeHead !== user.isGradeHead || actor.gradeId !== user.gradeId) return null;
  if (adminOnly ? !actor.isAdmin : !(actor.isAdmin || (actor.isGradeHead && actor.gradeId))) return null;
  return { id: actor.id, email: actor.email, name: actor.name, isAdmin: actor.isAdmin, sessionVersion: actor.sessionVersion, isGradeHead: actor.isGradeHead, gradeId: actor.gradeId };
}

/** Mọi năm học kèm học kỳ, năm có học kỳ bắt đầu muộn nhất trước; trong năm, học kỳ theo ngày bắt đầu. */
async function listSchoolYears(db: Reader): Promise<SchoolYearSummary[]> {
  const [years, allTerms, used, classYears] = await Promise.all([
    db.select().from(schoolYears),
    db.select().from(terms).orderBy(asc(terms.startsOn)),
    db.selectDistinct({ termId: sessions.termId }).from(sessions),
    db.selectDistinct({ schoolYearId: classes.schoolYearId }).from(classes),
  ]);
  const usedTerms = new Set(used.map((u) => u.termId));
  const latest = (y: SchoolYearSummary) => y.terms.at(-1)?.startsOn ?? "";
  return years
    .map((y) => ({
      id: y.id, name: y.name,
      terms: allTerms.filter((t) => t.schoolYearId === y.id).map((t) => ({ id: t.id, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })),
      deletable: !classYears.some((c) => c.schoolYearId === y.id) && !allTerms.some((t) => t.schoolYearId === y.id && usedTerms.has(t.id)),
    }))
    .sort((a, b) => latest(b).localeCompare(latest(a)));
}

/** Admin sees every year; other users see years containing classes they may read. */
export async function listSchoolYearsForUser(db: Db, user: AppUser): Promise<SchoolYearSummary[]> {
  const years = await listSchoolYears(db);
  if (canManageYears(user)) return years;
  const visible = await listClassesForUser(db, user);
  const ids = new Set(visible.map((c) => c.schoolYearId));
  return years.filter((y) => ids.has(y.id));
}

/** Current year, last started year in a holiday gap, then earliest available year. */
export async function resolveSchoolYearForUser(
  db: Db, user: AppUser, schoolYearId?: string, today: string = todayInVietnam(),
): Promise<SchoolYearSummary | null> {
  const years = await listSchoolYearsForUser(db, user);
  return years.find((y) => y.id === schoolYearId)
    ?? years.find((y) => y.terms.some((t) => t.startsOn <= today && today <= t.endsOn))
    ?? years.find((y) => y.terms.some((t) => t.startsOn <= today))
    ?? years.at(-1)
    ?? null;
}

/** Màn "Năm học" của trưởng khối: các năm học đã có + giá trị mặc định (năm gần nhất dời một năm). null với người khác. */
export async function schoolYearOverview(db: Db, user: AppUser, today: string): Promise<{ years: SchoolYearSummary[]; defaults: SchoolYearDraft } | null> {
  if (!canManageYears(user)) return null;
  const years = await listSchoolYears(db);
  return { years, defaults: suggestSchoolYear(years[0] ?? null, today) };
}

function overlapError(years: SchoolYearSummary[], label: string, term: TermInput): string | null {
  for (const y of years) {
    const hit = y.terms.find((t) => termsOverlap(t, term));
    if (hit) return `${label} trùng ngày với ${hit.name} (${y.name})`;
  }
  return null;
}

/**
 * Trưởng khối tạo năm học mới với đúng hai học kỳ (spec §3). Năm học dùng chung cho mọi khối (bảng `school_years` không
 * thuộc khối nào). Không đụng buổi học/điểm danh cũ: năm cũ thành "lưu trữ" theo ngày, `resolveTerm` chọn học kỳ chứa hôm nay.
 * Từ chối: tên trùng (không phân biệt hoa thường), khoảng ngày sai, học kỳ trùng ngày với học kỳ đã có.
 */
export async function createSchoolYear(db: Db, user: AppUser, input: unknown, today: string = todayInVietnam()): Promise<ActionResult<{ id: string }>> {
  if (!canManageYears(user)) return fail(FORBIDDEN);
  const p = yearSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const { name, term1, term2 } = p.data;
  const rangeError = validateTermRanges(term1, term2);
  if (rangeError) return fail(rangeError);
  const window = startWindow(today);
  if (!user.isAdmin && (term1.startsOn < window.min || term1.startsOn > window.max)) {
    return fail(`Học kỳ 1 phải bắt đầu trong khoảng ${START_WINDOW.before} ngày trước đến ${START_WINDOW.after} ngày sau hôm nay`);
  }

  return db.transaction(async (tx) => {
    const actor = await currentYearManager(tx, user);
    if (!actor) return fail(FORBIDDEN);
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const years = await listSchoolYears(tx);
    if (years.some((y) => sameName(y.name, name))) return fail("Đã có năm học tên này");
    const latest = latestStart(years);
    if (!actor.isAdmin && latest && term1.startsOn < latest.startsOn) {
      return fail(`Năm học mới phải bắt đầu sau năm học gần nhất (${latest.name} bắt đầu ${shortDate(latest.startsOn)})`);
    }
    const overlap = overlapError(years, "Học kỳ 1", term1) ?? overlapError(years, "Học kỳ 2", term2);
    if (overlap) return fail(overlap);
    const [year] = await tx.insert(schoolYears).values({ name }).returning({ id: schoolYears.id });
    await tx.insert(terms).values([term1, term2].map((t) => ({ schoolYearId: year.id, ...t })));
    await auditEveryGrade(tx, actor, {
      actorId: actor.id, entity: "school_year", entityId: year.id, action: "school_year.create",
      summary: {
        yearName: redactText(name),
        term1Start: term1.startsOn, term1End: term1.endsOn, term2Start: term2.startsOn, term2End: term2.endsOn,
      },
    });
    return ok({ id: year.id });
  });
}

/** Rename the label without moving classes, terms or historical attendance to another year. */
export async function renameSchoolYear(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!user.isAdmin) return fail(FORBIDDEN);
  const p = z.object({ schoolYearId: z.uuid(), name: z.string().trim().min(1, "Nhập tên năm học").max(40, "Tên năm học tối đa 40 ký tự") }).safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  return db.transaction(async (tx) => {
    const actor = await currentYearManager(tx, user, true);
    if (!actor) return fail(FORBIDDEN);
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const years = await tx.select().from(schoolYears);
    const year = years.find((y) => y.id === p.data.schoolYearId);
    if (!year) return fail(NO_YEAR);
    if (years.some((y) => y.id !== year.id && sameName(y.name, p.data.name))) return fail("Đã có năm học tên này");
    if (year.name === p.data.name) return ok(undefined);
    await tx.update(schoolYears).set({ name: p.data.name }).where(eq(schoolYears.id, year.id));
    await recordAudit(tx, {
      actorId: actor.id, entity: "school_year", entityId: year.id, action: "school_year.rename",
      summary: { beforeName: redactText(year.name), yearName: redactText(p.data.name) },
    });
    return ok(undefined);
  });
}

/** Năm học có học kỳ 1 bắt đầu muộn nhất (ngày bắt đầu của năm = học kỳ sớm nhất của năm đó). */
function latestStart(years: SchoolYearSummary[]): { name: string; startsOn: string } | null {
  return years
    .filter((y) => y.terms.length > 0)
    .map((y) => ({ name: y.name, startsOn: y.terms[0].startsOn }))
    .reduce<{ name: string; startsOn: string } | null>((best, y) => (!best || y.startsOn > best.startsOn ? y : best), null);
}

/**
 * Năm học dùng chung cho mọi khối nên mọi trưởng khối phải thấy việc tạo/xoá: ghi một dòng nhật ký cho MỖI khối đang có
 * lớp (và khối của người làm), trong cùng transaction. Số khối nhỏ (vài khối) nên chỉ vài dòng.
 */
async function auditEveryGrade(tx: Tx, user: AppUser, event: Omit<AuditEvent, "gradeId" | "classId">): Promise<void> {
  if (user.isAdmin) {
    await recordAudit(tx, event);
    return;
  }
  const rows = await tx.selectDistinct({ gradeId: classes.gradeId }).from(classes);
  const gradeIds = [...new Set([...(user.gradeId ? [user.gradeId] : []), ...rows.map((r) => r.gradeId)])];
  for (const gradeId of gradeIds) await recordAudit(tx, { ...event, gradeId });
}

const NO_YEAR = "Không tìm thấy năm học";

/**
 * Trưởng khối xoá một năm học tạo nhầm: chỉ khi CHƯA có buổi nào (học hay đi lễ) thuộc các học kỳ của năm (xoá năm sẽ
 * xoá dây chuyền học kỳ và buổi). Khoá các học kỳ (FOR UPDATE) để không ai mở buổi mới vào đó giữa lúc kiểm tra và xoá.
 */
export async function deleteSchoolYear(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!canManageYears(user)) return fail(FORBIDDEN);
  const p = z.object({ schoolYearId: z.uuid() }).safeParse(input);
  if (!p.success) return fail(NO_YEAR);
  const { schoolYearId } = p.data;
  return db.transaction(async (tx) => {
    const actor = await currentYearManager(tx, user);
    if (!actor) return fail(FORBIDDEN);
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const [year] = await tx.select().from(schoolYears).where(eq(schoolYears.id, schoolYearId));
    if (!year) return fail(NO_YEAR);
    const yearTerms = await tx.select({ id: terms.id }).from(terms).where(eq(terms.schoolYearId, year.id)).for("update");
    const ids = yearTerms.map((t) => t.id);
    const [used] = ids.length === 0 ? [] : await tx.select({ id: sessions.id }).from(sessions).where(inArray(sessions.termId, ids)).limit(1);
    if (used) return fail("Năm học đã có buổi điểm danh, không xoá được");
    const [usedClass] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.schoolYearId, year.id)).limit(1);
    if (usedClass) return fail("Năm học đã có lớp, không xoá được");
    await tx.delete(schoolYears).where(eq(schoolYears.id, year.id));
    await auditEveryGrade(tx, actor, {
      actorId: actor.id, entity: "school_year", entityId: year.id, action: "school_year.delete", summary: { yearName: redactText(year.name) },
    });
    return ok(undefined);
  });
}
