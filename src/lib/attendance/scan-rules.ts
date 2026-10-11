import type { AttendanceStatus } from "./warning";

export type ScanMode = "present" | "late";
export interface CurrentMark { status: AttendanceStatus; reason: string | null }

export type ScanDecision =
  | { kind: "apply"; status: "present" | "late" }
  | { kind: "noop"; reason: "already_present" | "already_late" }
  | { kind: "confirm"; defaultStatus: "present" | "late"; current: "absent_excused" | "absent_unexcused" };

/**
 * Bảng quy tắc §4.2 của spec. Dùng cho cả giao diện (lạc quan) lẫn máy chủ (quyết định thật).
 * `confirmStatus` chỉ có tác dụng khi em đang ở một trạng thái vắng.
 */
export function decideScan(
  current: CurrentMark | null,
  mode: ScanMode,
  confirmStatus?: "present" | "late",
): ScanDecision {
  if (current === null) return { kind: "apply", status: mode };
  switch (current.status) {
    case "present": return { kind: "noop", reason: "already_present" };
    case "late": return { kind: "noop", reason: "already_late" };
    default:
      return confirmStatus
        ? { kind: "apply", status: confirmStatus }
        : { kind: "confirm", defaultStatus: mode, current: current.status };
  }
}
