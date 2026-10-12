import { eq } from "drizzle-orm";
import { z } from "zod";
import { getGrade } from "@/db/queries/grades";
import { grades } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { MASS_THRESHOLD_MAX, MASS_THRESHOLD_MIN } from "@/lib/attendance/mass-tally";
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
 * Trưởng khối sửa ngưỡng cảnh báo đi lễ của CHÍNH khối mình. Trả về giá trị trước/sau để nhật ký thay đổi (P2) ghi lại
 * mà không phải đọc lại; chưa có bảng nhật ký nên hiện chỉ trả về.
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
  await db.update(grades).set({ massThreshold: threshold }).where(eq(grades.id, gradeId));
  return ok({ gradeId, before: grade.massThreshold, after: threshold });
}
