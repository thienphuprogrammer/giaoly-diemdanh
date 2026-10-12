import { asc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getGrade } from "@/db/queries/grades";
import { grades } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { MASS_THRESHOLD_MAX, MASS_THRESHOLD_MIN } from "@/lib/attendance/mass-tally";
import { recordAudit, writeWithAudit } from "../audit";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const RANGE = `Ngưỡng đi lễ là số nguyên từ ${MASS_THRESHOLD_MIN} đến ${MASS_THRESHOLD_MAX} tuần`;

const thresholdInput = z.object({
  gradeId: z.string(),
  // Form gửi chuỗi; "" hoặc chữ thì không phải số. z.coerce biến "" thành 0 nên kiểm tra chuỗi trước.
  threshold: z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, RANGE).transform(Number)])
    .pipe(z.number({ error: RANGE }).int(RANGE).min(MASS_THRESHOLD_MIN, RANGE).max(MASS_THRESHOLD_MAX, RANGE)),
});

export interface GradeSettings {
  gradeId: string;
  gradeName: string;
  massThreshold: number;
}

/** Cài đặt của khối mà người dùng làm trưởng khối; null với mọi người khác. */
export async function getGradeSettings(db: Db, user: AppUser): Promise<GradeSettings | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const grade = await getGrade(db, user.gradeId);
  return grade ? { gradeId: grade.id, gradeName: grade.name, massThreshold: grade.massThreshold } : null;
}

/**
 * Trưởng khối sửa ngưỡng cảnh báo đi lễ của CHÍNH khối mình. Đổi thật thì ghi nhật ký `grade.mass_threshold` (cấp khối:
 * `grade_id`, không `class_id`) cùng câu lệnh; cùng giá trị thì không ghi gì. Trả về giá trị trước/sau.
 */
export async function setMassThreshold(
  db: Db, user: AppUser, input: unknown,
): Promise<ActionResult<{ gradeId: string; before: number; after: number }>> {
  const p = thresholdInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? RANGE);
  const { gradeId, threshold } = p.data;
  if (!z.uuid().safeParse(gradeId).success || !canManageGrade(user, gradeId)) return fail(FORBIDDEN);
  const grade = await getGrade(db, gradeId);
  if (!grade) return fail(FORBIDDEN);
  if (grade.massThreshold !== threshold) {
    await writeWithAudit(db, db.update(grades).set({ massThreshold: threshold }).where(eq(grades.id, gradeId)).returning({ id: grades.id }), {
      actorId: user.id, gradeId, entity: "grade_settings", entityId: gradeId, action: "grade.mass_threshold",
      summary: { gradeName: redactText(grade.name), before: grade.massThreshold, after: threshold },
    });
  }
  return ok({ gradeId, before: grade.massThreshold, after: threshold });
}

const NO_GRADE = "Không tìm thấy khối";
const nextInput = z.object({ gradeId: z.string(), nextGradeId: z.string() });

export interface NextGradeSettings {
  gradeId: string;
  gradeName: string;
  nextGradeId: string | null;
  /** Các khối khác (tên công khai trong giáo xứ) để chọn làm khối kế tiếp. */
  options: { id: string; name: string }[];
}

export async function nextGradeSettings(db: Db, user: AppUser): Promise<NextGradeSettings | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const grade = await getGrade(db, user.gradeId);
  if (!grade) return null;
  const options = await db.select({ id: grades.id, name: grades.name }).from(grades).where(ne(grades.id, grade.id)).orderBy(asc(grades.name));
  return { gradeId: grade.id, gradeName: grade.name, nextGradeId: grade.nextGradeId, options };
}

/**
 * Trưởng khối của khối NGUỒN chọn khối kế tiếp (lên lớp được sang các lớp của khối đó) hoặc bỏ chọn (`""`).
 * Không có quản trị viên toàn hệ thống nên quyền này thuộc trưởng khối nguồn: họ chỉ chuyển được em CỦA KHỐI MÌNH sang lớp
 * khối kia và không đọc thêm được gì của khối kia. Đổi thật thì ghi nhật ký `grade.next_grade` cùng câu lệnh.
 */
export async function setNextGrade(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = nextInput.safeParse(input);
  if (!p.success) return fail("Dữ liệu không hợp lệ");
  const { gradeId } = p.data;
  if (!z.uuid().safeParse(gradeId).success || !canManageGrade(user, gradeId)) return fail(FORBIDDEN);
  const grade = await getGrade(db, gradeId);
  if (!grade) return fail(FORBIDDEN);
  const raw = p.data.nextGradeId.trim();
  let next: { id: string; name: string } | null = null;
  if (raw !== "") {
    if (raw === gradeId) return fail("Khối kế tiếp phải là một khối khác");
    next = z.uuid().safeParse(raw).success ? await getGrade(db, raw) : null;
    if (!next) return fail(NO_GRADE);
  }
  if ((next?.id ?? null) === grade.nextGradeId) return ok(undefined);
  const before = grade.nextGradeId ? await getGrade(db, grade.nextGradeId) : null;
  const summary = { gradeName: redactText(grade.name), before: before ? redactText(before.name) : null, after: next ? redactText(next.name) : null };
  // Một dòng cho khối nguồn và cho mỗi khối bị chọn/bỏ chọn, để trưởng khối đó thấy (băng báo màn "Năm học").
  const gradeIds = [...new Set([gradeId, next?.id, before?.id].filter((id): id is string => Boolean(id)))];
  await db.transaction(async (tx) => {
    await tx.update(grades).set({ nextGradeId: next?.id ?? null }).where(eq(grades.id, gradeId));
    for (const scope of gradeIds) {
      await recordAudit(tx, { actorId: user.id, gradeId: scope, entity: "grade_settings", entityId: gradeId, action: "grade.next_grade", summary });
    }
  });
  return ok(undefined);
}
