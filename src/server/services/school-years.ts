import { asc, sql } from "drizzle-orm";
import { z } from "zod";
import { schoolYears, terms } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { defaultSchoolYear, termsOverlap, validateTermRanges, type SchoolYearDraft, type TermInput } from "@/lib/school-year/defaults";
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
}

type Reader = Pick<Db, "select">;

/** Mọi năm học kèm học kỳ, năm có học kỳ bắt đầu muộn nhất trước; trong năm, học kỳ theo ngày bắt đầu. */
async function listSchoolYears(db: Reader): Promise<SchoolYearSummary[]> {
  const [years, allTerms] = await Promise.all([
    db.select().from(schoolYears),
    db.select().from(terms).orderBy(asc(terms.startsOn)),
  ]);
  const latest = (y: SchoolYearSummary) => y.terms.at(-1)?.startsOn ?? "";
  return years
    .map((y) => ({
      id: y.id, name: y.name,
      terms: allTerms.filter((t) => t.schoolYearId === y.id).map((t) => ({ id: t.id, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn })),
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
export async function createSchoolYear(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!isHead(user)) return fail(FORBIDDEN);
  const p = yearSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const { name, term1, term2 } = p.data;
  const rangeError = validateTermRanges(term1, term2);
  if (rangeError) return fail(rangeError);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${YEAR_LOCK})`);
    const years = await listSchoolYears(tx);
    if (years.some((y) => sameName(y.name, name))) return fail("Đã có năm học tên này");
    const overlap = overlapError(years, "Học kỳ 1", term1) ?? overlapError(years, "Học kỳ 2", term2);
    if (overlap) return fail(overlap);
    const [year] = await tx.insert(schoolYears).values({ name }).returning({ id: schoolYears.id });
    await tx.insert(terms).values([term1, term2].map((t) => ({ schoolYearId: year.id, ...t })));
    await recordAudit(tx, {
      actorId: user.id, gradeId: user.gradeId, entity: "school_year", entityId: year.id, action: "school_year.create",
      summary: {
        yearName: redactText(name),
        term1Start: term1.startsOn, term1End: term1.endsOn, term2Start: term2.startsOn, term2End: term2.endsOn,
      },
    });
    return ok({ id: year.id });
  });
}
