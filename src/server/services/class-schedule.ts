import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { classes } from "@/db/schema";
import type { Db } from "@/db/types";
import { canAccess, canManageGrade, type AccessClass, type AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { parseScheduleInput, scheduleLabel, toHhMm, type ClassSchedule } from "@/lib/class-schedule";
import { recordAudit } from "../audit";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";

/**
 * Ai sửa được lịch học: GLV được phân công lớp (quyền ghi) và trưởng khối của lớp. Lịch học là cài đặt của lớp (dùng để
 * nhắc việc, Task 39) chứ không phải dữ liệu điểm danh, nên trưởng khối — người sắp xếp lớp trong khối — cũng chỉnh được.
 */
const canEditSchedule = (user: AppUser, cls: AccessClass) => canAccess(user, cls, "write") || canManageGrade(user, cls.gradeId);

export interface ClassScheduleView extends ClassSchedule { label: string | null; canEdit: boolean }

/** null khi không đọc được lớp (id sai, không tồn tại, ngoài quyền đọc). */
export async function getClassSchedule(db: Db, user: AppUser, classId: string): Promise<ClassScheduleView | null> {
  if (!z.uuid().safeParse(classId).success) return null;
  const cls = await getAccessClass(db, classId);
  if (!cls || !canAccess(user, cls, "read")) return null;
  const [row] = await db.select({ meetsOn: classes.meetsOn, meetsAt: classes.meetsAt }).from(classes).where(eq(classes.id, classId));
  if (!row) return null;
  const schedule = { meetsOn: row.meetsOn, meetsAt: toHhMm(row.meetsAt) };
  return { ...schedule, label: scheduleLabel(schedule), canEdit: canEditSchedule(user, cls) };
}

/**
 * Đặt hoặc xoá (cả hai trống) lịch học. Đổi thật thì ghi nhật ký `class.schedule` (trước/sau dạng "Chủ nhật 08:00")
 * trong cùng transaction; cùng giá trị thì không ghi gì.
 */
export async function setClassSchedule(db: Db, user: AppUser, input: unknown): Promise<ActionResult<ClassSchedule>> {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : null;
  const classId = raw?.classId;
  if (typeof classId !== "string" || !z.uuid().safeParse(classId).success) return fail(FORBIDDEN);
  const cls = await getAccessClass(db, classId);
  if (!cls || !canEditSchedule(user, cls)) return fail(FORBIDDEN);
  const parsed = parseScheduleInput({ meetsOn: raw?.meetsOn, meetsAt: raw?.meetsAt });
  if (!parsed.ok) return fail(parsed.error);
  const next = parsed.value;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(classes).where(eq(classes.id, classId)).for("update");
    if (!row) return fail(FORBIDDEN);
    const before = { meetsOn: row.meetsOn, meetsAt: toHhMm(row.meetsAt) };
    if (before.meetsOn === next.meetsOn && before.meetsAt === next.meetsAt) return ok(next);
    await tx.update(classes).set({ meetsOn: next.meetsOn, meetsAt: next.meetsAt }).where(eq(classes.id, classId));
    await recordAudit(tx, {
      actorId: user.id, classId, entity: "class", entityId: classId, action: "class.schedule",
      summary: { className: redactText(row.name), before: scheduleLabel(before), after: scheduleLabel(next) },
    });
    return ok(next);
  });
}
