import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classes, schoolYears, sessions, terms } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { START_WINDOW, defaultSchoolYear, startWindow, termsOverlap, validateTermRanges, type SchoolYearDraft, type TermInput } from "@/lib/school-year/defaults";
import type { AuditEvent } from "../audit";
import { recordAudit } from "../audit";
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

const isHead = (user: AppUser): user is AppUser & { gradeId: string } => user.isGradeHead && !!user.gradeId;
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");

export interface SchoolYearSummary {
  id: string;
  name: string;
  terms: { id: string; name: string; startsOn: string; endsOn: string }[];
  /** Chưa có buổi nào (học hay đi lễ) trong các học kỳ của năm: xoá được. */
  deletable: boolean;
}

type Reader = Pick<Db, "select" | "selectDistinct">;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Mọi năm học kèm học kỳ, năm có học kỳ bắt đầu muộn nhất trước; trong năm, học kỳ theo ngày bắt đầu. */
async function listSchoolYears(db: Reader): Promise<SchoolYearSummary[]> {
  const [years, allTerms, used] = await Promise.all([
    db.select().from(schoolYears),
    db.select().from(terms).orderBy(asc(terms.startsOn)),
    db.selectDistinct({ termId: sessions.termId }).from(sessions),
  ]);
  const usedTerms = new Set(used.map((u) => u.termId));
  const latest = (y: SchoolYearSummary) => y.terms.at(-1)?.startsOn ?? "";
  return years
    .map((y) => ({
      id: y.id, name: y.name,
      terms: allTerms.filter((t) => t.schoolYearId === y.id).map((t) => ({ id: t.id, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })),
      deletable: !allTerms.some((t) => t.schoolYearId === y.id && usedTerms.has(t.id)),
    }))
    .sort((a, b) => latest(b).localeCompare(latest(a)));
}

/** Màn "Năm học" của trưởng khối: các năm học đã có + giá trị mặc định (năm gần nhất dời một năm). null với người khác. */
export async function schoolYearOverview(db: Db, user: AppUser, today: string): Promise<{ years: SchoolYearSummary[]; defaults: SchoolYearDraft } | null> {
  if (!isHead(user)) return null;
  const years = await listSchoolYears(db);
  return { years, defaults: defaultSchoolYear(years[0] ?? null, today) };
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
  if (!isHead(user)) return fail(FORBIDDEN);
  const p = yearSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const { name, term1, term2 } = p.data;
  const rangeError = validateTermRanges(term1, term2);
  if (rangeError) return fail(rangeError);
  const window = startWindow(today);
  if (term1.startsOn < window.min || term1.startsOn > window.max) {
    return fail(`Học kỳ 1 phải bắt đầu trong khoảng ${START_WINDOW.before} ngày trước đến ${START_WINDOW.after} ngày sau hôm nay`);
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const years = await listSchoolYears(tx);
    if (years.some((y) => sameName(y.name, name))) return fail("Đã có năm học tên này");
    const latest = latestStart(years);
    if (latest && term1.startsOn < latest.startsOn) {
      return fail(`Năm học mới phải bắt đầu sau năm học gần nhất (${latest.name} bắt đầu ${shortDate(latest.startsOn)})`);
    }
    const overlap = overlapError(years, "Học kỳ 1", term1) ?? overlapError(years, "Học kỳ 2", term2);
    if (overlap) return fail(overlap);
    const [year] = await tx.insert(schoolYears).values({ name }).returning({ id: schoolYears.id });
    await tx.insert(terms).values([term1, term2].map((t) => ({ schoolYearId: year.id, ...t })));
    await auditEveryGrade(tx, user, {
      actorId: user.id, entity: "school_year", entityId: year.id, action: "school_year.create",
      summary: {
        yearName: redactText(name),
        term1Start: term1.startsOn, term1End: term1.endsOn, term2Start: term2.startsOn, term2End: term2.endsOn,
      },
    });
    return ok({ id: year.id });
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
async function auditEveryGrade(tx: Tx, user: AppUser & { gradeId: string }, event: Omit<AuditEvent, "gradeId" | "classId">): Promise<void> {
  const rows = await tx.selectDistinct({ gradeId: classes.gradeId }).from(classes);
  const gradeIds = [...new Set([user.gradeId, ...rows.map((r) => r.gradeId)])];
  for (const gradeId of gradeIds) await recordAudit(tx, { ...event, gradeId });
}

const NO_YEAR = "Không tìm thấy năm học";

/**
 * Trưởng khối xoá một năm học tạo nhầm: chỉ khi CHƯA có buổi nào (học hay đi lễ) thuộc các học kỳ của năm (xoá năm sẽ
 * xoá dây chuyền học kỳ và buổi). Khoá các học kỳ (FOR UPDATE) để không ai mở buổi mới vào đó giữa lúc kiểm tra và xoá.
 */
export async function deleteSchoolYear(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  if (!isHead(user)) return fail(FORBIDDEN);
  const p = z.object({ schoolYearId: z.uuid() }).safeParse(input);
  if (!p.success) return fail(NO_YEAR);
  const { schoolYearId } = p.data;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const [year] = await tx.select().from(schoolYears).where(eq(schoolYears.id, schoolYearId));
    if (!year) return fail(NO_YEAR);
    const yearTerms = await tx.select({ id: terms.id }).from(terms).where(eq(terms.schoolYearId, year.id)).for("update");
    const ids = yearTerms.map((t) => t.id);
    const [used] = ids.length === 0 ? [] : await tx.select({ id: sessions.id }).from(sessions).where(inArray(sessions.termId, ids)).limit(1);
    if (used) return fail("Năm học đã có buổi điểm danh, không xoá được");
    await tx.delete(schoolYears).where(eq(schoolYears.id, year.id));
    await auditEveryGrade(tx, user, {
      actorId: user.id, entity: "school_year", entityId: year.id, action: "school_year.delete", summary: { yearName: redactText(year.name) },
    });
    return ok(undefined);
  });
}
