import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { attendance, classes, sessions, students, terms } from "../schema";
import type { Db } from "../types";
import { membershipOf, type Membership } from "@/lib/promotion";
import { studentColumns } from "./students";

export const listTerms = (db: Db) => db.select().from(terms).orderBy(desc(terms.startsOn));

export async function resolveTerm(db: Db, termId: string | undefined, today: string) {
  const all = await listTerms(db);
  // Ngoài mọi học kỳ: học kỳ gần nhất ĐÃ bắt đầu (danh sách mới trước), nếu chưa có thì học kỳ sớm nhất. Không bao giờ
  // chọn một học kỳ tương lai khi đã có học kỳ đã bắt đầu (năm học tạo sẵn cho tương lai không thành "hiện tại").
  return all.find((t) => t.id === termId)
    ?? all.find((t) => t.startsOn <= today && today <= t.endsOn)
    ?? all.find((t) => t.startsOn <= today)
    ?? all.at(-1)
    ?? null;
}

export async function rosterOf(db: Db, classIds: string[]) {
  if (classIds.length === 0) return [];
  return db.select(studentColumns).from(students)
    .where(and(inArray(students.classId, classIds), eq(students.active, true)))
    .orderBy(asc(students.fullName));
}

/** Học kỳ đã kết thúc trước hôm nay (ngày Việt Nam). */
export const isPastTerm = (term: { endsOn: string }, today: string): boolean => term.endsOn < today;

/** `former`/`inactive` theo quy tắc chung `membershipOf` (src/lib/promotion.ts). */
export type RosterEntry = Awaited<ReturnType<typeof rosterOf>>[number] & Membership;

/**
 * Danh sách em để thống kê một học kỳ:
 * - học kỳ hiện tại/tương lai: em ĐANG học ở lớp (theo lớp hiện tại);
 * - học kỳ đã qua: em đang học ở lớp ∪ em có dòng điểm danh (buổi học hoặc đi lễ) ở các buổi của lớp trong học kỳ đó,
 *   để em đã lên lớp (hoặc đã nghỉ) không biến mất khỏi số liệu cũ. `classId` của dòng là lớp đang thống kê; nhãn
 *   `former`/`inactive` theo `membershipOf` (lớp hiện tại của em ≠ lớp của buổi => `former`).
 * Không bao giờ chọn `qr_token`.
 */
export async function termRoster(db: Db, classIds: string[], term: { id: string; endsOn: string }, today: string): Promise<RosterEntry[]> {
  const current = (await rosterOf(db, classIds)).map((s) => ({ ...s, ...membershipOf({ currentClassId: s.classId, active: s.active }, s.classId) }));
  if (!isPastTerm(term, today) || classIds.length === 0) return current;
  const pairs = await db
    .selectDistinct({ ...studentColumns, currentClassId: students.classId, classId: sessions.classId })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .innerJoin(students, eq(students.id, attendance.studentId))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, term.id)));
  const have = new Set(current.map((s) => `${s.classId}:${s.id}`));
  const former = pairs
    .filter((p) => !have.has(`${p.classId}:${p.id}`))
    .map(({ currentClassId, ...p }) => ({ ...p, ...membershipOf({ currentClassId, active: p.active }, p.classId) }));
  return [...current, ...former].sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
}

/** Dòng điểm danh các buổi HỌC (không huỷ, không gồm đi lễ) của các lớp trong học kỳ, kèm lớp của buổi. */
export async function termRecords(db: Db, classIds: string[], termId: string) {
  if (classIds.length === 0) return [];
  return db
    .select({ classId: sessions.classId, studentId: attendance.studentId, status: attendance.status })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.kind, "class"), eq(sessions.cancelled, false)));
}

/** Chỉ đếm buổi học (không gồm đi lễ), không huỷ và đã có ít nhất một dòng điểm danh (buổi trống do mở ngày không tính). */
export async function sessionsHeld(db: Db, classIds: string[], termId: string): Promise<Map<string, number>> {
  if (classIds.length === 0) return new Map();
  const rows = await db
    .select({ classId: sessions.classId, n: sql<number>`count(distinct ${sessions.id})::int` })
    .from(sessions)
    .innerJoin(attendance, eq(attendance.sessionId, sessions.id))
    .where(and(inArray(sessions.classId, classIds), eq(sessions.termId, termId), eq(sessions.kind, "class"), eq(sessions.cancelled, false)))
    .groupBy(sessions.classId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

export const classesInGrade = (db: Db, gradeId: string) =>
  db.select().from(classes).where(eq(classes.gradeId, gradeId)).orderBy(asc(classes.name));
