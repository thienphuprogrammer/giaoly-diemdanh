import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { findSession, findTermFor, getSession, loadBoardData, unexcusedCount, type BoardStudent } from "@/db/queries/attendance";
import { getStudent } from "@/db/queries/students";
import { attendance, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { todayInVietnam } from "@/lib/dates";
import { evaluateWarningFromCount, type WarningResult } from "@/lib/attendance/warning";
import type { Assignment, Layout } from "@/lib/seating/types";
import { NOT_FOUND, classPermissions, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const NOT_FOUND_SESSION = "Không tìm thấy buổi học";
const CANCELLED = "Buổi này đã được đánh dấu nghỉ lễ";
const STATUSES = ["present", "absent_excused", "absent_unexcused", "late"] as const;

export interface Board {
  sessionId: string;
  classId: string;
  heldOn: string;
  cancelled: boolean;
  canWrite: boolean;
  students: BoardStudent[];
  plan: { layout: Layout; assignments: Assignment[] } | null;
}

export async function openSession(db: Db, user: AppUser, input: unknown, now: Date = new Date()): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ classId: z.string(), heldOn: z.iso.date("Ngày không hợp lệ") }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await guardClass(db, user, p.data.classId, "write"))) return fail(NOT_FOUND);
  if (p.data.heldOn > todayInVietnam(now)) return fail("Không thể điểm danh cho ngày chưa tới"); // YYYY-MM-DD so sánh được theo chuỗi
  const term = await findTermFor(db, p.data.heldOn);
  if (!term) return fail("Ngày này không thuộc học kỳ nào");
  await db.insert(sessions).values({ classId: p.data.classId, termId: term.id, heldOn: p.data.heldOn }).onConflictDoNothing();
  const session = await findSession(db, p.data.classId, p.data.heldOn);
  return session ? ok({ id: session.id }) : fail(NOT_FOUND_SESSION);
}

async function loadWritableSession(db: Db, user: AppUser, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return null;
  return session;
}

export async function setStatus(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ warning: WarningResult }>> {
  const p = z.object({
    sessionId: z.string(),
    studentId: z.string(),
    status: z.enum(STATUSES).nullable(),
    reason: z.string().trim().max(200, "Lý do tối đa 200 ký tự").nullable(),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  if (session.cancelled) return fail(CANCELLED);
  if (!z.uuid().safeParse(p.data.studentId).success) return fail("Không tìm thấy thiếu nhi");
  const student = await getStudent(db, p.data.studentId);
  if (!student || student.classId !== session.classId || !student.active) return fail("Không tìm thấy thiếu nhi");

  if (p.data.status === null) {
    await db.delete(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, student.id)));
  } else {
    const values = { status: p.data.status, reason: p.data.reason || null, updatedBy: user.id, updatedAt: new Date(), lastEventId: null };
    await db.insert(attendance)
      .values({ sessionId: session.id, studentId: student.id, ...values })
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: values });
  }
  return ok({ warning: evaluateWarningFromCount(await unexcusedCount(db, student.id, session.termId)) });
}

export async function markAllPresent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ marked: number }>> {
  const p = z.object({ sessionId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  if (session.cancelled) return fail(CANCELLED);
  const roster = await db.select({ id: students.id }).from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)));
  const markedIds = new Set(
    (await db.select({ id: attendance.studentId }).from(attendance).where(eq(attendance.sessionId, session.id))).map((m) => m.id),
  );
  const missing = roster.filter((s) => !markedIds.has(s.id));
  if (missing.length > 0) {
    await db.insert(attendance)
      .values(missing.map((m) => ({ sessionId: session.id, studentId: m.id, status: "present" as const, updatedBy: user.id })))
      .onConflictDoNothing();
  }
  return ok({ marked: missing.length });
}

export async function setCancelled(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ sessionId: z.string(), cancelled: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  await db.update(sessions).set({ cancelled: p.data.cancelled }).where(eq(sessions.id, session.id));
  return ok(undefined);
}

export async function readBoard(db: Db, user: AppUser, sessionId: string): Promise<Board | null> {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session) return null;
  const perms = await classPermissions(db, user, session.classId);
  if (!perms.canRead) return null;
  const data = await loadBoardData(db, session);
  return {
    sessionId: session.id,
    classId: session.classId,
    heldOn: session.heldOn,
    cancelled: session.cancelled,
    canWrite: perms.canWrite,
    ...data,
  };
}
