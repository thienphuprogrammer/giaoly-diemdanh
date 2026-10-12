import { z } from "zod";
import { getClassById, listClassesForUser } from "@/db/queries/classes";
import { getGrade } from "@/db/queries/grades";
import { massGrid, type MassGridStudent } from "@/db/queries/mass-stats";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { isMassWarning, tallyMass, type MassCell, type MassWeek } from "@/lib/attendance/mass-tally";
import { todayInVietnam } from "@/lib/dates";
import { guardClass } from "../guard";

export interface MassStatRow {
  studentId: string;
  fullName: string;
  saintName: string | null;
  recordedWeeksCounted: number;
  attendedWeeks: number;
  missedWeeks: number;
  warning: boolean;
  /** Cùng thứ tự với `MassStats.weeks`. */
  cells: readonly MassCell[];
}

export interface MassStats {
  term: { id: string; name: string };
  className: string;
  threshold: number;
  weeks: MassWeek[];
  rows: MassStatRow[];
  totals: { recordedWeeks: number; students: number; warnings: number; countedWeeks: number; attendedWeeks: number };
}

async function pickTerm(db: Db, termId: string | undefined, today: string) {
  if (termId === undefined) return resolveTerm(db, undefined, today);
  if (!z.uuid().safeParse(termId).success) return null;
  return (await listTerms(db)).find((t) => t.id === termId) ?? null;
}

function statRow(weeks: readonly MassWeek[], s: MassGridStudent, threshold: number): MassStatRow {
  const t = tallyMass(weeks, s.firstSeen, s.attended);
  return {
    studentId: s.id, fullName: s.fullName, saintName: s.saintName,
    recordedWeeksCounted: t.counted, attendedWeeks: t.attended, missedWeeks: t.missed,
    warning: isMassWarning(t.missed, threshold), cells: t.cells,
  };
}

/**
 * Thống kê đi lễ của một lớp trong học kỳ (spec §1b). Chỉ buổi `kind='mass'`; bỏ tuần huỷ/rỗng; em vào lớp giữa kỳ
 * chỉ tính từ dòng điểm danh đầu tiên. Quyền như `classStats` (đọc lớp); null cho mọi trường hợp khác (trang trả 404).
 */
export async function massStats(
  db: Db, user: AppUser, input: { classId: string; termId?: string; today?: string },
): Promise<MassStats | null> {
  const cls = await guardClass(db, user, input.classId, "read");
  if (!cls) return null;
  const [term, info, grade] = await Promise.all([
    pickTerm(db, input.termId, input.today ?? todayInVietnam()), getClassById(db, cls.id), getGrade(db, cls.gradeId),
  ]);
  if (!term || !info || !grade) return null;
  const grid = await massGrid(db, { classIds: [cls.id], termId: term.id });
  const weeks = grid.weeks.get(cls.id) ?? [];
  const rows = grid.students.map((s) => statRow(weeks, s, grade.massThreshold));
  return {
    term: { id: term.id, name: term.name },
    className: info.name,
    threshold: grade.massThreshold,
    weeks,
    rows,
    totals: {
      recordedWeeks: weeks.length,
      students: rows.length,
      warnings: rows.filter((r) => r.warning).length,
      countedWeeks: rows.reduce((n, r) => n + r.recordedWeeksCounted, 0),
      attendedWeeks: rows.reduce((n, r) => n + r.attendedWeeks, 0),
    },
  };
}

export interface MassAttentionItem {
  classId: string;
  className: string;
  studentId: string;
  fullName: string;
  missed: number;
  threshold: number;
  /** Chỉ để dựng liên kết gọi trên trang "Cần chú ý" (server render); không đưa xuống props client. */
  parentPhone: string | null;
}

/** Các em chạm ngưỡng vắng lễ của khối, trên mọi lớp người dùng đọc được (nhóm "Đi lễ" của trang "Cần chú ý"). */
export async function massAttentionList(db: Db, user: AppUser, termId: string): Promise<MassAttentionItem[]> {
  if (!z.uuid().safeParse(termId).success) return [];
  const visible = await listClassesForUser(db, user);
  if (visible.length === 0) return [];
  const names = new Map(visible.map((c) => [c.id, c.name]));
  const grid = await massGrid(db, { classIds: visible.map((c) => c.id), termId });
  return grid.students
    .map((s) => ({ s, missed: tallyMass(grid.weeks.get(s.classId) ?? [], s.firstSeen, s.attended).missed }))
    .filter(({ s, missed }) => isMassWarning(missed, s.threshold))
    .map(({ s, missed }) => ({
      classId: s.classId, className: names.get(s.classId) ?? "", studentId: s.id, fullName: s.fullName,
      missed, threshold: s.threshold, parentPhone: s.parentPhone,
    }))
    .sort((a, b) =>
      b.missed - a.missed ||
      a.className.localeCompare(b.className, "vi") ||
      a.fullName.localeCompare(b.fullName, "vi"));
}
