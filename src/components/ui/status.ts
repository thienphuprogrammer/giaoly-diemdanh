import { Check, CircleDashed, Clock, ShieldCheck, X, type LucideIcon } from "lucide-react";
import type { AttendanceStatus } from "@/lib/attendance/warning";

export type StatusKey = AttendanceStatus | "none";

interface StatusMeta {
  /** Nhãn ngắn hiện trên ô ghế, chú thích và thống kê. */
  short: string;
  icon: LucideIcon;
  /** Nền đặc + chữ trắng (ô ghế, nút đang chọn). */
  solid: string;
  /** Nền nhạt + chữ đậm màu trạng thái (pill, dòng danh sách). */
  tint: string;
  /** Mẫu màu nhỏ trong chú thích. */
  swatch: string;
}

export const STATUS_META: Record<StatusKey, StatusMeta> = {
  present: {
    short: "Có mặt", icon: Check,
    solid: "border-st-present bg-st-present text-white",
    tint: "border-st-present/25 bg-st-present-tint text-st-present",
    swatch: "border-st-present bg-st-present",
  },
  absent_unexcused: {
    short: "Vắng KP", icon: X,
    solid: "border-st-unexcused bg-st-unexcused text-white",
    tint: "border-st-unexcused/25 bg-st-unexcused-tint text-st-unexcused",
    swatch: "border-st-unexcused bg-st-unexcused",
  },
  absent_excused: {
    short: "Có phép", icon: ShieldCheck,
    solid: "border-st-excused bg-st-excused text-white",
    tint: "border-st-excused/25 bg-st-excused-tint text-st-excused",
    swatch: "border-st-excused bg-st-excused",
  },
  late: {
    short: "Muộn", icon: Clock,
    solid: "border-st-late bg-st-late text-white",
    tint: "border-st-late/25 bg-st-late-tint text-st-late",
    swatch: "border-st-late bg-st-late",
  },
  none: {
    short: "Chưa", icon: CircleDashed,
    solid: "border-dashed border-st-none bg-surface text-ink-soft",
    tint: "border-dashed border-st-none bg-surface text-ink-soft",
    swatch: "border-dashed border-st-none bg-surface",
  },
};

export const STATUS_ORDER: StatusKey[] = ["present", "absent_unexcused", "absent_excused", "late", "none"];
