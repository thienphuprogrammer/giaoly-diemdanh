export type AttendanceStatus =
  | "present"
  | "absent_excused"
  | "absent_unexcused"
  | "late";

export type WarningLevel = "none" | "watch" | "warning";

export interface AttendanceRules {
  /** Số buổi vắng không phép trong một học kỳ để bị cảnh báo. */
  readonly unexcusedThreshold: number;
}

export const DEFAULT_RULES: AttendanceRules = { unexcusedThreshold: 2 };

export interface WarningResult {
  readonly level: WarningLevel;
  readonly unexcused: number;
  /** Số buổi vắng không phép nữa thì chạm ngưỡng (0 khi đã chạm). */
  readonly remaining: number;
}

export function countUnexcused(records: ReadonlyArray<{ status: AttendanceStatus }>): number {
  return records.filter((r) => r.status === "absent_unexcused").length;
}

export function evaluateWarningFromCount(
  unexcused: number,
  rules: AttendanceRules = DEFAULT_RULES,
): WarningResult {
  const remaining = Math.max(0, rules.unexcusedThreshold - unexcused);
  const level: WarningLevel =
    unexcused >= rules.unexcusedThreshold ? "warning" : unexcused > 0 ? "watch" : "none";
  return { level, unexcused, remaining };
}

export function evaluateWarning(
  records: ReadonlyArray<{ status: AttendanceStatus }>,
  rules: AttendanceRules = DEFAULT_RULES,
): WarningResult {
  return evaluateWarningFromCount(countUnexcused(records), rules);
}
