import { DEFAULT_RULES, evaluateWarning, type AttendanceRules, type AttendanceStatus, type WarningResult } from "./warning";

export interface StudentSummary {
  present: number;
  excused: number;
  unexcused: number;
  late: number;
  marked: number;
  warning: WarningResult;
}

export function summarize(
  records: ReadonlyArray<{ status: AttendanceStatus }>,
  rules: AttendanceRules = DEFAULT_RULES,
): StudentSummary {
  const count = (s: AttendanceStatus) => records.filter((r) => r.status === s).length;
  return {
    present: count("present"),
    excused: count("absent_excused"),
    unexcused: count("absent_unexcused"),
    late: count("late"),
    marked: records.length,
    warning: evaluateWarning(records, rules),
  };
}
