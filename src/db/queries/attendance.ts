import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { visibleAssignments } from "@/lib/seating/assignments";
import type { Assignment, Layout } from "@/lib/seating/types";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { attendance, seatAssignments, seatingPlans, sessions, students, terms, type SessionKind } from "../schema";
import type { Db } from "../types";
import { missedMassWeeks } from "./mass-stats";
import { studentColumns } from "./students";

export async function findTermFor(db: Db, date: string, schoolYearId?: string) {
  const [row] = await db
    .select({ id: terms.id, name: terms.name })
    .from(terms)
    .where(and(lte(terms.startsOn, date), gte(terms.endsOn, date), schoolYearId ? eq(terms.schoolYearId, schoolYearId) : undefined));
  return row ?? null;
}

/** Buổi của lớp trong ngày theo loại; mặc định buổi học (`class`), không bao giờ lẫn buổi đi lễ cùng ngày. */
export async function findSession(db: Db, classId: string, heldOn: string, kind: SessionKind = "class") {
  const [row] = await db.select().from(sessions)
    .where(and(eq(sessions.classId, classId), eq(sessions.heldOn, heldOn), eq(sessions.kind, kind)));
  return row ?? null;
}

/** Dấu điểm danh hiện có của một em trong buổi (trước khi ghi đè), để nhật ký có "trước → sau". */
export async function getMark(db: Db, sessionId: string, studentId: string) {
  const [row] = await db.select({ status: attendance.status, reason: attendance.reason }).from(attendance)
    .where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId)));
  return row ?? null;
}

/**
 * Em kèm dấu hiện có của em trong buổi, trong MỘT truy vấn (đường chạm tay trên bảng: đọc em vốn đã cần, nên lấy "trước"
 * cho nhật ký không tốn thêm lượt khứ hồi). `mark` null = chưa có dòng.
 */
export async function getStudentWithMark(db: Db, studentId: string, sessionId: string) {
  const [row] = await db.select({ ...studentColumns, markStatus: attendance.status, markReason: attendance.reason })
    .from(students)
    .leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.sessionId, sessionId)))
    .where(eq(students.id, studentId));
  if (!row) return null;
  const { markStatus, markReason, ...student } = row;
  return { student, mark: markStatus === null ? null : { status: markStatus, reason: markReason } };
}

export async function getSession(db: Db, id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ?? null;
}

/** Số buổi HỌC vắng không phép của một em trong học kỳ, bỏ qua buổi nghỉ lễ và buổi đi lễ. */
export async function unexcusedCount(db: Db, studentId: string, termId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(attendance.studentId, studentId),
      eq(sessions.termId, termId),
      eq(sessions.kind, "class"),
      eq(sessions.cancelled, false),
      eq(attendance.status, "absent_unexcused"),
    ));
  return row?.n ?? 0;
}

/** Các buổi học (không gồm buổi đi lễ) của lớp, mới nhất trước. */
export function listSessions(db: Db, classId: string, limit = 30) {
  return db
    .select({
      id: sessions.id,
      heldOn: sessions.heldOn,
      cancelled: sessions.cancelled,
      marked: sql<number>`count(${attendance.studentId})::int`,
      absent: sql<number>`(count(*) filter (where ${attendance.status} = 'absent_unexcused'))::int`,
    })
    .from(sessions)
    .leftJoin(attendance, eq(attendance.sessionId, sessions.id))
    .where(and(eq(sessions.classId, classId), eq(sessions.kind, "class")))
    .groupBy(sessions.id)
    .orderBy(desc(sessions.heldOn))
    .limit(limit);
}

export interface BoardStudent {
  id: string;
  fullName: string;
  saintName: string | null;
  status: AttendanceStatus | null;
  reason: string | null;
  priorUnexcused: number;
}

/** Số buổi HỌC vắng không phép trước đó trong học kỳ (quy tắc cảnh báo ≥2), bỏ buổi nghỉ lễ và chính buổi này. */
async function priorClassUnexcused(db: Db, session: typeof sessions.$inferSelect): Promise<Map<string, number>> {
  const rows = await db
    .select({ studentId: attendance.studentId, n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(sessions.classId, session.classId),
      eq(sessions.termId, session.termId),
      eq(sessions.kind, "class"),
      eq(sessions.cancelled, false),
      ne(sessions.id, session.id),
      eq(attendance.status, "absent_unexcused"),
    ))
    .groupBy(attendance.studentId);
  return new Map(rows.map((r) => [r.studentId, r.n]));
}

export async function loadBoardData(db: Db, session: typeof sessions.$inferSelect) {
  const roster = await db.select(studentColumns).from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)))
    .orderBy(asc(students.fullName));
  const marks = await db.select().from(attendance).where(eq(attendance.sessionId, session.id));
  // "Vắng trước đó" theo loại buổi, vẫn một truy vấn: buổi học = số buổi học vắng KP; buổi đi lễ = số tuần đi lễ đã
  // ghi nhận mà em không đi (`missedMassWeeks`, định nghĩa spec §1b), không tính buổi đang mở.
  const priorOf = session.kind === "mass"
    ? await missedMassWeeks(db, { classId: session.classId, termId: session.termId, excludeSessionId: session.id })
    : await priorClassUnexcused(db, session);

  const markOf = new Map(marks.map((m) => [m.studentId, m]));
  const boardStudents: BoardStudent[] = roster.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    saintName: s.saintName,
    status: markOf.get(s.id)?.status ?? null,
    reason: markOf.get(s.id)?.reason ?? null,
    priorUnexcused: priorOf.get(s.id) ?? 0,
  }));

  const [plan] = await db.select().from(seatingPlans)
    .where(and(eq(seatingPlans.classId, session.classId), eq(seatingPlans.isActive, true)));
  let planData: { layout: Layout; assignments: Assignment[] } | null = null;
  if (plan) {
    const rows = await db.select().from(seatAssignments).where(eq(seatAssignments.planId, plan.id));
    const assignments = rows.map((r) => ({ benchId: r.benchId, seatIndex: r.seatIndex, studentId: r.studentId }));
    planData = { layout: plan.layout, assignments: visibleAssignments(assignments, new Set(roster.map((s) => s.id))) };
  }
  return { students: boardStudents, plan: planData };
}
