import { shortDate } from "@/lib/date-label";
import { DEFAULT_RULES } from "@/lib/attendance/warning";
import { membershipNote } from "@/lib/promotion";
import type { StudentSummary } from "@/lib/attendance/summary";

const DASH = "—";

/** Đầu vào dựng một dòng báo cáo: chỉ số liệu chuyên cần, không có SĐT hay mã QR. */
export interface ReportInput {
  studentId: string;
  fullName: string;
  saintName: string | null;
  former: boolean;
  inactive: boolean;
  summary: StudentSummary;
  /** Số liệu đi lễ của em (null nếu không có thống kê đi lễ). */
  mass?: { recordedWeeksCounted: number; attendedWeeks: number; missedWeeks: number; warning: boolean } | null;
}

export interface ReportRow {
  stt: number;
  studentId: string;
  saintName: string;
  fullName: string;
  present: number;
  late: number;
  excused: number;
  unexcused: number;
  percent: string;
  mass: string;
  warning: string;
}

export interface ReportTotals {
  students: number;
  present: number;
  late: number;
  excused: number;
  unexcused: number;
  percent: string;
  mass: string;
  warnings: number;
}

/** "86%" (vi-VN: dấu phẩy thập phân khi có chữ số lẻ); "—" khi chưa có số liệu (không bao giờ NaN). */
export function formatPercent(ratio: number | null, digits = 0): string {
  if (ratio === null || !Number.isFinite(ratio)) return DASH;
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(ratio * 100)}%`;
}

/** Tỉ lệ chuyên cần = (có mặt + đi muộn) / số buổi đã ghi; null khi chưa có buổi nào. */
export function attendanceRatio(s: Pick<StudentSummary, "present" | "late" | "marked">): number | null {
  return s.marked === 0 ? null : (s.present + s.late) / s.marked;
}

export const termRangeLabel = (startsOn: string, endsOn: string): string => `${shortDate(startsOn)} – ${shortDate(endsOn)}`;

const massLabel = (counted: number, attended: number): string => (counted === 0 ? DASH : `${attended}/${counted}`);

/** Chữ cảnh báo (không chỉ màu): vắng KP chạm ngưỡng và/hoặc vắng lễ chạm ngưỡng của khối. */
function warningText(r: ReportInput): string {
  const parts = [
    r.summary.warning.level === "warning" ? `Cảnh báo: ≥${DEFAULT_RULES.unexcusedThreshold} vắng KP` : "",
    r.mass?.warning ? "Vắng lễ ≥ ngưỡng" : "",
  ];
  return parts.filter(Boolean).join("; ");
}

export function buildReportRows(rows: readonly ReportInput[]): ReportRow[] {
  return rows.map((r, i) => {
    const note = membershipNote(r);
    return {
      stt: i + 1,
      studentId: r.studentId,
      saintName: r.saintName ?? "",
      fullName: note ? `${r.fullName} ${note}` : r.fullName,
      present: r.summary.present,
      late: r.summary.late,
      excused: r.summary.excused,
      unexcused: r.summary.unexcused,
      percent: formatPercent(attendanceRatio(r.summary)),
      mass: r.mass ? massLabel(r.mass.recordedWeeksCounted, r.mass.attendedWeeks) : DASH,
      warning: warningText(r),
    };
  });
}

export function buildReportTotals(rows: readonly ReportInput[]): ReportTotals {
  const sum = (pick: (r: ReportInput) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const marked = sum((r) => r.summary.marked);
  const here = sum((r) => r.summary.present + r.summary.late);
  return {
    students: rows.length,
    present: sum((r) => r.summary.present),
    late: sum((r) => r.summary.late),
    excused: sum((r) => r.summary.excused),
    unexcused: sum((r) => r.summary.unexcused),
    percent: formatPercent(marked === 0 ? null : here / marked),
    mass: massLabel(sum((r) => r.mass?.recordedWeeksCounted ?? 0), sum((r) => r.mass?.attendedWeeks ?? 0)),
    warnings: rows.filter((r) => r.summary.warning.level === "warning" || r.mass?.warning).length,
  };
}
