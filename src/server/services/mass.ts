import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { findSession } from "@/db/queries/attendance";
import { getStudent } from "@/db/queries/students";
import { attendance, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { MASS_STATUSES, toMassStatus, type MassMark } from "@/lib/attendance/mass-marks";
import { massSundayFor } from "@/lib/attendance/mass-week";
import { classPermissions } from "../guard";
import { fail, ok, type ActionResult } from "../result";
import { NOT_FOUND_STUDENT, checkOpenInput, presentBatch, undoPresentBatch, writeManualMark } from "./attendance";
import { openMassOfWeek } from "./mass-sessions";

/**
 * Đi lễ "cách 1": tích nhanh trên bảng điểm danh của buổi học. Mọi service ở đây nhận NGÀY HỌC (`heldOn` của buổi học)
 * và ghi vào buổi `mass` của Chúa nhật tương ứng (`massSundayFor`), mở buổi đó ở lần ghi đầu tiên (idempotent).
 * Quy ước ghi giống điểm danh học: chạm tay ghi đè và đặt `lastEventId = null`; "Cả lớp đi lễ" chỉ điền em chưa hỏi,
 * gắn một `batchId`; hoàn tác chỉ xoá dòng còn nguyên từ lần đó (thiết bị khác sửa sau thì giữ kết quả mới hơn).
 */

type Session = typeof sessions.$inferSelect;

export interface MassBoard {
  /** Chúa nhật của thánh lễ ứng với ngày học. */
  sunday: string;
  /** null = tuần này chưa ghi đi lễ (chưa có buổi `mass`). */
  sessionId: string | null;
  cancelled: boolean;
  canWrite: boolean;
  /** Chỉ các em đã có câu trả lời; em không có ở đây = "chưa hỏi". */
  marks: Record<string, MassMark>;
}

const classDay = z.object({ classId: z.string(), heldOn: z.iso.date("Ngày không hợp lệ") });
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

/** Dấu đi lễ của tuần chứa ngày học, cho người đọc được lớp; không tạo buổi `mass`. null = không có quyền/sai dữ liệu. */
export async function readMassMarks(db: Db, user: AppUser, input: unknown): Promise<MassBoard | null> {
  const p = classDay.safeParse(input);
  if (!p.success) return null;
  const perms = await classPermissions(db, user, p.data.classId);
  if (!perms.canRead) return null;
  const sunday = massSundayFor(p.data.heldOn);
  const session = await findSession(db, p.data.classId, sunday, "mass");
  const rows = session
    ? await db.select({ studentId: attendance.studentId, status: attendance.status, reason: attendance.reason })
      .from(attendance)
      .innerJoin(students, eq(students.id, attendance.studentId))
      .where(and(eq(attendance.sessionId, session.id), eq(students.classId, p.data.classId), eq(students.active, true)))
    : [];
  return {
    sunday,
    sessionId: session?.id ?? null,
    cancelled: session?.cancelled ?? false,
    canWrite: perms.canWrite,
    marks: Object.fromEntries(rows.map((r) => [r.studentId, { status: toMassStatus(r.status), reason: r.reason }])),
  };
}

/** Buổi `mass` của tuần (đã kiểm tra quyền ghi): có sẵn thì dùng, chưa có thì mở khi `create`. */
async function massOfWeek(db: Db, classId: string, heldOn: string, create: boolean): Promise<ActionResult<Session | null>> {
  const existing = await findSession(db, classId, massSundayFor(heldOn), "mass");
  if (existing || !create) return ok(existing);
  return openMassOfWeek(db, classId, heldOn);
}

/** Chạm một em: có đi lễ / không đi có phép / không đi không phép / chưa hỏi (null, xoá dòng). Không có "đi muộn". */
export async function setMassStatus(db: Db, user: AppUser, input: unknown, now: Date = new Date()): Promise<ActionResult> {
  const p = classDay.extend({ studentId: z.string(), status: z.enum(MASS_STATUSES).nullable() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const checked = await checkOpenInput(db, user, p.data, now);
  if (!checked.ok) return checked;
  // Kiểm tra em trước khi mở buổi: dữ liệu sai không được để lại một buổi đi lễ rỗng.
  const student = z.uuid().safeParse(p.data.studentId).success ? await getStudent(db, p.data.studentId) : null;
  if (!student || student.classId !== p.data.classId || !student.active) return fail(NOT_FOUND_STUDENT);
  const session = await massOfWeek(db, p.data.classId, p.data.heldOn, p.data.status !== null);
  if (!session.ok) return session;
  if (!session.data) return ok(undefined); // "chưa hỏi" khi tuần này chưa ghi gì: không có gì để xoá
  const written = await writeManualMark(db, user, session.data, student.id, p.data.status, null);
  return written.ok ? ok(undefined) : written;
}

/** "Cả lớp đi lễ": ghi "có đi lễ" cho các em chưa hỏi, gắn chung `batchId` (như "Tất cả có mặt"). */
export async function markClassAtMass(
  db: Db, user: AppUser, input: unknown, now: Date = new Date(),
): Promise<ActionResult<{ marked: number; batchId: string; studentIds: string[] }>> {
  const checked = await checkOpenInput(db, user, input, now);
  if (!checked.ok) return checked;
  const session = await massOfWeek(db, checked.data.classId, checked.data.heldOn, true);
  if (!session.ok) return session;
  return session.data ? presentBatch(db, user, session.data) : fail("Không mở được buổi đi lễ");
}

/** Hoàn tác một lần "Cả lớp đi lễ" (chỉ trên buổi `mass` của tuần đó). Chưa có buổi đi lễ => không có gì để hoàn tác. */
export async function undoClassAtMass(
  db: Db, user: AppUser, input: unknown, now: Date = new Date(),
): Promise<ActionResult<{ studentIds: string[] }>> {
  const p = classDay.extend({ batchId: z.uuid("Không hoàn tác được") }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const checked = await checkOpenInput(db, user, p.data, now);
  if (!checked.ok) return checked;
  const session = await massOfWeek(db, p.data.classId, p.data.heldOn, false);
  if (!session.ok) return session;
  return session.data ? undoPresentBatch(db, session.data, p.data.batchId) : ok({ studentIds: [] });
}
