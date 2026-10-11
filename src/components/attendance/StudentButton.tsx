"use client";
import { Ellipsis, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import { STATUS_META } from "@/components/ui/status";
import { STATUS_LABEL } from "@/lib/attendance/ui";
import type { AttendanceStatus, WarningLevel } from "@/lib/attendance/warning";
import { shortName } from "@/lib/students/short-name";

interface Props {
  fullName: string;
  status: AttendanceStatus | null;
  warning: WarningLevel;
  /** Số buổi vắng không phép trong học kỳ (kể cả buổi này), hiện trên cờ cảnh báo. */
  absences?: number;
  failed?: boolean;
  disabled?: boolean;
  /** Hiện dải "…" (mặc định khi không bị khoá). Để true khi chỉ tạm khoá, tránh ô ghế đổi kích thước. */
  showOptions?: boolean;
  onTap: () => void;
  onLongPress: () => void;
}

const LONG_MS = 500;
const CLICK_GUARD_MS = 60;
/**
 * Kích thước ô ghế dùng chung cho sơ đồ điểm danh và trình xếp chỗ. Ô điểm danh chia hai vùng: trên là
 * vùng chạm điểm danh, dưới là dải "…" cao 44px (h-11) — đủ vùng chạm mà không lấn vùng chạm chính,
 * và không tràn ra ô bên cạnh. Chiều rộng giữ nguyên để số cột trên điện thoại không đổi.
 */
export const SEAT_TILE = "h-[88px] w-16 sm:h-24 sm:w-20";
const OPTIONS_STRIP =
  "flex h-11 w-full shrink-0 items-center justify-between gap-0.5 rounded-b-control border-2 border-t-0 border-border-strong bg-surface px-1 text-ink-soft transition-colors enabled:hover:bg-surface-muted enabled:hover:text-ink disabled:opacity-50";

export function StudentButton({ fullName, status, warning, absences, failed, disabled, showOptions = !disabled, onTap, onLongPress }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const start = () => {
    clearTimeout(timer.current);
    fired.current = false;
    timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, LONG_MS);
  };
  // Dừng đếm; nếu đã nhấn giữ xong thì giữ cờ `fired` một lúc để nuốt đúng cú click đi kèm,
  // rồi reset để lần bấm bàn phím sau không bị nuốt nhầm.
  const stop = () => {
    clearTimeout(timer.current);
    if (fired.current) setTimeout(() => { fired.current = false; }, CLICK_GUARD_MS);
  };
  const warningText = warning === "warning" ? ", cảnh báo vắng" : warning !== "none" ? ", đã vắng 1 buổi" : "";
  const meta = STATUS_META[status ?? "none"];
  const badge = warning !== "none" && (
    <span aria-hidden
      className={`flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border-[1.5px] bg-surface px-1 font-display text-xs font-semibold leading-none ${warning === "warning" ? "border-warn-alert text-warn-alert" : "border-warn-watch text-warn-watch"}`}>
      <TriangleAlert size={12} strokeWidth={2.5} />
      {absences ? <span className="tabular-nums">{absences}</span> : null}
    </span>
  );
  return (
    <div className={`relative flex flex-col ${SEAT_TILE} ${failed ? "rounded-control ring-[3px] ring-warn-alert ring-offset-2" : ""}`}>
      <button
        disabled={disabled}
        aria-label={`${fullName}: ${status ? STATUS_LABEL[status] : "chưa điểm danh"}${warningText}`}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={() => { if (fired.current) { fired.current = false; return; } onTap(); }}
        onContextMenu={(e) => e.preventDefault()}
        className={`flex min-h-11 w-full flex-1 touch-manipulation select-none flex-col items-center justify-center gap-1 border-2 px-0.5 transition-[transform,background-color,color,border-color] duration-150 enabled:active:scale-95 ${showOptions ? "rounded-t-control" : "rounded-control"} ${meta.solid}`}
      >
        <span className="w-full truncate text-center font-display text-sm font-semibold leading-tight sm:text-base">{shortName(fullName)}</span>
        <span className="font-display text-xs font-medium leading-none">{meta.short}</span>
      </button>
      {!showOptions ? (
        badge && <span className="pointer-events-none absolute left-0.5 top-0.5">{badge}</span>
      ) : (
        <button aria-label={`Mở lựa chọn cho ${fullName}`} onClick={onLongPress} disabled={disabled} className={OPTIONS_STRIP}>
          {badge || <span />}
          <Ellipsis aria-hidden size={18} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
