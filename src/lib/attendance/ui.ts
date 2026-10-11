import type { AttendanceStatus } from "./warning";

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Có mặt",
  absent_excused: "Vắng có phép",
  absent_unexcused: "Vắng không phép",
  late: "Đi muộn",
};
