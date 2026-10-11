import type { AttendanceStatus } from "./warning";

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Có mặt",
  absent_excused: "Vắng có phép",
  absent_unexcused: "Vắng không phép",
  late: "Đi muộn",
};

export const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present: "border-st-present bg-st-present text-white",
  absent_excused: "border-st-excused bg-st-excused text-white",
  absent_unexcused: "border-st-unexcused bg-st-unexcused text-white",
  late: "border-st-late bg-st-late text-white",
};

export const NONE_CLASS = "border-dashed border-st-none bg-paper text-ink-soft";
