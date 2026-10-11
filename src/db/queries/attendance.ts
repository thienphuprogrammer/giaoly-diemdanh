import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { visibleAssignments } from "@/lib/seating/assignments";
import type { Assignment, Layout } from "@/lib/seating/types";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { attendance, seatAssignments, seatingPlans, sessions, students, terms } from "../schema";
import type { Db } from "../types";
import { studentColumns } from "./students";

export async function findTermFor(db: Db, date: string) {
  const [row] = await db
    .select({ id: terms.id, name: terms.name })
    .from(terms)
    .where(and(lte(terms.startsOn, date), gte(terms.endsOn, date)));
  return row ?? null;
}

export async function findSession(db: Db, classId: string, heldOn: string) {
  const [row] = await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.heldOn, heldOn)));
  return row ?? null;
}

export async function getSession(db: Db, id: string) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  return row ?? null;
}

/** Số buổi vắng không phép của một em trong học kỳ, bỏ qua buổi nghỉ lễ. */
export async function unexcusedCount(db: Db, studentId: string, termId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(attendance.studentId, studentId),
      eq(sessions.termId, termId),
      eq(sessions.cancelled, false),
      eq(attendance.status, "absent_unexcused"),
    ));
  return row?.n ?? 0;
}

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
    .where(eq(sessions.classId, classId))
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

export async function loadBoardData(db: Db, session: typeof sessions.$inferSelect) {
  const roster = await db.select(studentColumns).from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)))
    .orderBy(asc(students.fullName));
  const marks = await db.select().from(attendance).where(eq(attendance.sessionId, session.id));
  const prior = await db
    .select({ studentId: attendance.studentId, n: sql<number>`count(*)::int` })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(
      eq(sessions.classId, session.classId),
      eq(sessions.termId, session.termId),
      eq(sessions.cancelled, false),
      ne(sessions.id, session.id),
      eq(attendance.status, "absent_unexcused"),
    ))
    .groupBy(attendance.studentId);

  const markOf = new Map(marks.map((m) => [m.studentId, m]));
  const priorOf = new Map(prior.map((p) => [p.studentId, p.n]));
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
