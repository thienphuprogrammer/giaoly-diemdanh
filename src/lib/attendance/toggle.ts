import type { AttendanceStatus } from "./warning";

/** Chạm ghế: chưa điểm danh → có mặt → vắng không phép → có mặt. Các trạng thái khác về có mặt. */
export function toggleStatus(current: AttendanceStatus | null): AttendanceStatus {
  return current === "present" ? "absent_unexcused" : "present";
}
