import type { AttendanceStatus } from "./warning";

/** Thông điệp chung của máy chủ và máy quét khi thẻ không thuộc lớp/buổi này. */
export const INVALID_CARD = "Thẻ không dùng được cho lớp này";
/** Buổi nghỉ lễ: máy quét từ chối mọi lượt (máy chủ cũng từ chối). */
export const SESSION_CANCELLED = "Buổi này nghỉ lễ — không điểm danh";

/** Tuần đi lễ được đánh dấu "không có lễ": máy quét tại nhà thờ từ chối mọi lượt (máy chủ cũng từ chối). */
export const MASS_CANCELLED_SCAN = "Tuần này không có lễ — không ghi đi lễ";

/** Loại buổi của màn quét: buổi học giáo lý hoặc thánh lễ Chúa nhật (cùng giá trị với `sessions.kind`). */
export type ScanKind = "class" | "mass";

/** Lý do máy quét từ chối mọi lượt của buổi (null = được quét; chưa tải bảng tra thì chưa biết, để máy chủ quyết định). */
export function scanRefusal(session: { cancelled: boolean } | null, kind: ScanKind = "class"): string | null {
  if (!session?.cancelled) return null;
  return kind === "mass" ? MASS_CANCELLED_SCAN : SESSION_CANCELLED;
}

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
