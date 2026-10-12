import { z } from "zod";
import { getGrade } from "@/db/queries/grades";
import { listTerms } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { todayInVietnam } from "@/lib/dates";
import type { ReportInput } from "@/lib/report/term-report";
import { guardClass } from "../guard";
import { massAttentionList, massStats } from "./mass-stats";
import { attentionList, classStats, gradeOverview } from "./stats";

export interface ReportTerm { id: string; name: string; startsOn: string; endsOn: string }

async function findTerm(db: Db, termId: string): Promise<ReportTerm | null> {
  if (!z.uuid().safeParse(termId).success) return null;
  const t = (await listTerms(db)).find((x) => x.id === termId);
  return t ? { id: t.id, name: t.name, startsOn: t.startsOn, endsOn: t.endsOn } : null;
}

export interface ClassTermReport {
  className: string;
  gradeName: string;
  term: ReportTerm;
  massThreshold: number;
  /** Số tuần đi lễ đã ghi trong học kỳ. */
  massWeeks: number;
  rows: ReportInput[];
}

/**
 * Dữ liệu báo cáo học kỳ in được của một lớp: chỉ từ `classStats` + `massStats` (cùng quyền đọc lớp; null => 404).
 * Không có `qr_token` và SĐT: hai nguồn trên không chọn các cột đó.
 */
export async function classTermReport(db: Db, user: AppUser, classId: string, termId: string, today: string = todayInVietnam()): Promise<ClassTermReport | null> {
  const cls = await guardClass(db, user, classId, "read");
  if (!cls) return null;
  const [stats, term, grade] = await Promise.all([classStats(db, user, classId, termId, today), findTerm(db, termId), getGrade(db, cls.gradeId)]);
  if (!stats || !term || !grade) return null;
  const mass = await massStats(db, user, { classId, termId: term.id, today });
  const massBy = new Map((mass?.rows ?? []).map((m) => [m.studentId, m]));
  return {
    className: stats.className,
    gradeName: grade.name,
    term,
    massThreshold: grade.massThreshold,
    massWeeks: mass?.totals.recordedWeeks ?? 0,
    rows: stats.rows.map((r) => {
      const m = massBy.get(r.studentId);
      return {
        studentId: r.studentId, fullName: r.fullName, saintName: r.saintName, former: r.former, inactive: r.inactive, summary: r.summary,
        mass: m ? { recordedWeeksCounted: m.recordedWeeksCounted, attendedWeeks: m.attendedWeeks, missedWeeks: m.missedWeeks, warning: m.warning } : null,
      };
    }),
  };
}

export interface GradeReportClass {
  classId: string;
  className: string;
  studentCount: number;
  sessions: number;
  presentRate: number | null;
  unexcusedWarnings: number;
  massWarnings: number;
  massWeeks: number;
}

export interface GradeReportWarning {
  studentId: string;
  fullName: string;
  className: string;
  /** Vắng KP (số buổi) khi chạm ngưỡng; null nếu không cảnh báo loại này. */
  unexcused: number | null;
  /** Số tuần vắng lễ khi chạm ngưỡng; null nếu không cảnh báo loại này. */
  missedMass: number | null;
}

export interface GradeReport {
  gradeName: string;
  term: ReportTerm;
  classes: GradeReportClass[];
  warnings: GradeReportWarning[];
}

/** Tổng hợp khối cho trưởng khối (chỉ trưởng khối của khối đó; người khác => null). Không có SĐT trong kết quả. */
export async function gradeReport(db: Db, user: AppUser, termId: string, today: string = todayInVietnam()): Promise<GradeReport | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const [term, grade, overview] = await Promise.all([findTerm(db, termId), getGrade(db, user.gradeId), gradeOverview(db, user, termId, today)]);
  if (!term || !grade || !overview) return null;
  const [attention, massAttention, massByClass] = await Promise.all([
    attentionList(db, user, term.id, today),
    massAttentionList(db, user, term.id, today),
    Promise.all(overview.map((c) => massStats(db, user, { classId: c.classId, termId: term.id, today }))),
  ]);
  // Người dùng có thể được gán vào lớp của khối khác: danh sách chỉ gồm lớp của khối này.
  const inGrade = new Set(overview.map((c) => c.classId));
  const unexcused = attention.filter((a) => a.level === "warning" && inGrade.has(a.classId));
  const massWarned = massAttention.filter((m) => inGrade.has(m.classId));
  // Cột theo lớp dùng cùng nguồn với /khoi và thống kê đi lễ (tính cả em đã lên lớp/đã nghỉ ở học kỳ đã qua);
  // danh sách em chỉ gồm em đang học ở lớp (hành động được).
  const classes = overview.map((c, i) => ({
    classId: c.classId, className: c.className, studentCount: c.studentCount, sessions: c.sessions, presentRate: c.presentRate,
    unexcusedWarnings: c.warningCount,
    massWarnings: massByClass[i]?.totals.warnings ?? 0,
    massWeeks: massByClass[i]?.totals.recordedWeeks ?? 0,
  }));
  const ids = new Set([...unexcused.map((a) => a.studentId), ...massWarned.map((m) => m.studentId)]);
  const warnings = [...ids].map((studentId) => {
    const a = unexcused.find((x) => x.studentId === studentId);
    const m = massWarned.find((x) => x.studentId === studentId);
    return {
      studentId, fullName: (a ?? m)!.fullName, className: (a ?? m)!.className,
      unexcused: a ? a.unexcused : null, missedMass: m ? m.missed : null,
    };
  }).sort((x, y) => x.className.localeCompare(y.className, "vi") || x.fullName.localeCompare(y.fullName, "vi"));
  return { gradeName: grade.name, term, classes, warnings };
}
