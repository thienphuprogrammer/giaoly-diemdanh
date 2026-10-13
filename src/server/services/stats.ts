import { getClassById, listClassesForUser } from "@/db/queries/classes";
import { classesInGrade, resolveTerm, sessionsHeld, termById, termRecords, termRoster, type RosterEntry } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { summarize, type StudentSummary } from "@/lib/attendance/summary";
import { todayInVietnam } from "@/lib/dates";
import { isActionable } from "@/lib/promotion";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { z } from "zod";
import { guardClass } from "../guard";

export interface StatRow {
  studentId: string;
  classId: string;
  fullName: string;
  saintName: string | null;
  summary: StudentSummary;
  /** Nhãn theo `membershipOf`: đã lên lớp khác / đã nghỉ (chỉ ở học kỳ đã qua). */
  former: boolean;
  inactive: boolean;
}

const key = (classId: string, studentId: string) => `${classId}:${studentId}`;

/**
 * Mỗi em được tính theo các dòng ở đúng lớp của dòng thống kê (em chuyển lớp không mang dòng của lớp cũ sang lớp mới).
 * Dùng chung cho thống kê, "Cần chú ý" và thông báo ngưỡng của tác vụ nhắc việc (cùng một quy tắc cảnh báo).
 */
export function buildRows(roster: RosterEntry[], records: { classId: string; studentId: string; status: AttendanceStatus }[]): StatRow[] {
  const byStudent = new Map<string, { status: AttendanceStatus }[]>();
  for (const r of records) {
    const k = key(r.classId, r.studentId);
    byStudent.set(k, [...(byStudent.get(k) ?? []), { status: r.status }]);
  }
  return roster.map((s) => ({
    studentId: s.id, classId: s.classId, fullName: s.fullName, saintName: s.saintName, former: s.former, inactive: s.inactive,
    summary: summarize(byStudent.get(key(s.classId, s.id)) ?? []),
  }));
}

export async function classStats(db: Db, user: AppUser, classId: string, termId?: string, today: string = todayInVietnam()) {
  if (!(await guardClass(db, user, classId, "read"))) return null;
  const cls = await getClassById(db, classId);
  if (!cls) return null;
  const term = termId === undefined ? await resolveTerm(db, undefined, today, cls.schoolYearId) : await termById(db, termId);
  if (!term || term.schoolYearId !== cls.schoolYearId) return null;
  const [roster, records] = await Promise.all([termRoster(db, [classId], term, today), termRecords(db, [classId], term.id)]);
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

export async function attentionList(db: Db, user: AppUser, termId: string, today: string = todayInVietnam()): Promise<AttentionItem[]> {
  const term = await termById(db, termId);
  if (!term) return [];
  const visible = await listClassesForUser(db, user, term.schoolYearId);
  const ids = visible.map((c) => c.id);
  const names = new Map(visible.map((c) => [c.id, c.name]));
  const [roster, records] = await Promise.all([termRoster(db, ids, term, today), termRecords(db, ids, term.id)]);
  const phones = new Map(roster.map((s) => [s.id, s.parentPhone]));
  // Danh sách cần hành động: chỉ em đang học ở lớp (bỏ em đã lên lớp khác/đã nghỉ của học kỳ đã qua).
  return buildRows(roster, records)
    .filter((r) => isActionable(r) && r.summary.warning.level !== "none")
    .map((r) => ({
      classId: r.classId, className: names.get(r.classId) ?? "", studentId: r.studentId, fullName: r.fullName,
      level: r.summary.warning.level as "watch" | "warning", unexcused: r.summary.unexcused, parentPhone: phones.get(r.studentId) ?? null,
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

export async function gradeOverview(db: Db, user: AppUser, termId: string, today: string = todayInVietnam(), selectedGradeId?: string): Promise<GradeRow[] | null> {
  const gradeId = user.isAdmin ? selectedGradeId ?? user.gradeId : user.isGradeHead ? user.gradeId : null;
  if (!gradeId || !z.uuid().safeParse(gradeId).success) return null;
  const term = await termById(db, termId);
  if (!term) return [];
  const classList = await classesInGrade(db, gradeId, term.schoolYearId);
  const ids = classList.map((c) => c.id);
  const [roster, records, held] = await Promise.all([termRoster(db, ids, term, today), termRecords(db, ids, term.id), sessionsHeld(db, ids, term.id)]);
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
