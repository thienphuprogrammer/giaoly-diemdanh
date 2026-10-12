import { z } from "zod";
import { getClassById, listClassesForUser } from "@/db/queries/classes";
import { classesInGrade, listTerms, rosterOf, sessionsHeld, termRecords } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { summarize, type StudentSummary } from "@/lib/attendance/summary";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { guardClass } from "../guard";

export interface StatRow {
  studentId: string;
  classId: string;
  fullName: string;
  saintName: string | null;
  summary: StudentSummary;
}

type Roster = Awaited<ReturnType<typeof rosterOf>>;

function buildRows(roster: Roster, records: { studentId: string; status: AttendanceStatus }[]): (StatRow & { parentPhone: string | null })[] {
  const byStudent = new Map<string, { status: AttendanceStatus }[]>();
  for (const r of records) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), { status: r.status }]);
  return roster.map((s) => ({
    studentId: s.id, classId: s.classId, fullName: s.fullName, saintName: s.saintName, parentPhone: s.parentPhone,
    summary: summarize(byStudent.get(s.id) ?? []),
  }));
}

async function termOf(db: Db, termId: string) {
  if (!z.uuid().safeParse(termId).success) return null;
  return (await listTerms(db)).find((t) => t.id === termId) ?? null;
}

export async function classStats(db: Db, user: AppUser, classId: string, termId: string) {
  if (!(await guardClass(db, user, classId, "read"))) return null;
  const term = await termOf(db, termId);
  const cls = await getClassById(db, classId);
  if (!term || !cls) return null;
  const [roster, records] = await Promise.all([rosterOf(db, [classId]), termRecords(db, [classId], term.id)]);
  return { term: { id: term.id, name: term.name }, className: cls.name, rows: buildRows(roster, records) };
}

export interface AttentionItem {
  classId: string;
  className: string;
  studentId: string;
  fullName: string;
  level: "watch" | "warning";
  unexcused: number;
  /** Chỉ để dựng liên kết gọi trên trang "Cần chú ý" (server render); không đưa xuống props client. */
  parentPhone: string | null;
}

export async function attentionList(db: Db, user: AppUser, termId: string): Promise<AttentionItem[]> {
  const term = await termOf(db, termId);
  if (!term) return [];
  const visible = await listClassesForUser(db, user);
  const ids = visible.map((c) => c.id);
  const names = new Map(visible.map((c) => [c.id, c.name]));
  const [roster, records] = await Promise.all([rosterOf(db, ids), termRecords(db, ids, term.id)]);
  return buildRows(roster, records)
    .filter((r) => r.summary.warning.level !== "none")
    .map((r) => ({
      classId: r.classId, className: names.get(r.classId) ?? "", studentId: r.studentId, fullName: r.fullName,
      level: r.summary.warning.level as "watch" | "warning", unexcused: r.summary.unexcused, parentPhone: r.parentPhone,
    }))
    .sort((a, b) =>
      Number(b.level === "warning") - Number(a.level === "warning") ||
      b.unexcused - a.unexcused ||
      a.className.localeCompare(b.className, "vi") ||
      a.fullName.localeCompare(b.fullName, "vi"));
}

export interface GradeRow {
  classId: string;
  className: string;
  studentCount: number;
  sessions: number;
  presentRate: number | null;
  warningCount: number;
}

export async function gradeOverview(db: Db, user: AppUser, termId: string): Promise<GradeRow[] | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const term = await termOf(db, termId);
  const classList = await classesInGrade(db, user.gradeId);
  const ids = classList.map((c) => c.id);
  if (!term) return classList.map((c) => ({ classId: c.id, className: c.name, studentCount: 0, sessions: 0, presentRate: null, warningCount: 0 }));
  const [roster, records, held] = await Promise.all([rosterOf(db, ids), termRecords(db, ids, term.id), sessionsHeld(db, ids, term.id)]);
  const rows = buildRows(roster, records);
  return classList.map((c) => {
    const mine = rows.filter((r) => r.classId === c.id);
    const marked = mine.reduce((n, r) => n + r.summary.marked, 0);
    const here = mine.reduce((n, r) => n + r.summary.present + r.summary.late, 0);
    return {
      classId: c.id, className: c.name, studentCount: mine.length, sessions: held.get(c.id) ?? 0,
      presentRate: marked === 0 ? null : here / marked,
      warningCount: mine.filter((r) => r.summary.warning.level === "warning").length,
    };
  });
}
