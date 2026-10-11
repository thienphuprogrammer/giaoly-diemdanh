import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { attendance, classes, sessions, students, terms } from "../schema";
import type { Db } from "../types";

export const listTerms = (db: Db) => db.select().from(terms).orderBy(desc(terms.startsOn));

export async function resolveTerm(db: Db, termId: string | undefined, today: string) {
  const all = await listTerms(db);
  return all.find((t) => t.id === termId) ?? all.find((t) => t.startsOn <= today && today <= t.endsOn) ?? all[0] ?? null;
}

export async function rosterOf(db: Db, classIds: string[]) {
  if (classIds.length === 0) return [];
  return db.select().from(students)
    .where(and(inArray(students.classId, classIds), eq(students.active, true)))
    .orderBy(asc(students.fullName));
}

export async function termRecords(db: Db, classIds: string[], termId: string) {
  if (classIds.length === 0) return [];
  return db
    .select({ studentId: attendance.studentId, status: attendance.status })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.cancelled, false)));
}

/** Chỉ đếm buổi không huỷ và đã có ít nhất một dòng điểm danh (buổi trống do mở ngày không tính). */
export async function sessionsHeld(db: Db, classIds: string[], termId: string): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const rows = await db
    .select({ classId: sessions.classId, n: sql<number>`count(distinct ${sessions.id})::int` })
    .from(sessions)
    .innerJoin(attendance, eq(attendance.sessionId, sessions.id))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.cancelled, false)))
    .groupBy(sessions.classId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

export const classesInGrade = (db: Db, gradeId: string) =>
  db.select().from(classes).where(eq(classes.gradeId, gradeId)).orderBy(asc(classes.name));
