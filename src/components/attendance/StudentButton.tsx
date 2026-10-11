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
  onTap: () => void;
  onLongPress: () => void;
}

const LONG_MS = 500;
const CLICK_GUARD_MS = 60;
// Vùng chạm 36×36px ở góc phải trên (vòng tròn nhìn thấy 28px). Không lên 44px được: ô ghế trên điện thoại
// chỉ rộng 64px, vùng 44px sẽ phủ lên giữa ô và cướp cú chạm điểm danh chính. Phải nằm HOÀN TOÀN trong khung
// ô ghế (không dùng offset âm): nếu tràn ra ngoài sẽ che góc ghế bên cạnh và gây mở nhầm bảng chọn của em khác.
const OPTIONS_CLASS = "group absolute right-0 top-0 z-10 flex h-9 w-9 items-start justify-end p-0.5";
const OPTIONS_DOT =
  "flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface text-ink-soft transition-colors group-hover:bg-surface-muted group-hover:text-ink";

/** Kích thước ô ghế dùng chung cho sơ đồ điểm danh và trình xếp chỗ. */
export const SEAT_TILE = "h-[72px] w-16 sm:h-20 sm:w-20";

export function StudentButton({ fullName, status, warning, absences, failed, disabled, onTap, onLongPress }: Props) {
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
  return (
    <div className={`relative ${SEAT_TILE}`}>
      <button
        disabled={disabled}
        aria-label={`${fullName}: ${status ? STATUS_LABEL[status] : "chưa điểm danh"}${warningText}`}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={() => { if (fired.current) { fired.current = false; return; } onTap(); }}
        onContextMenu={(e) => e.preventDefault()}
        className={`flex h-full w-full touch-manipulation select-none flex-col items-center justify-end gap-1 rounded-control border-2 px-0.5 pb-2 transition-[transform,background-color,color,border-color] duration-150 enabled:active:scale-95 ${meta.solid} ${failed ? "ring-[3px] ring-warn-alert ring-offset-2" : ""}`}
      >
        <span className="w-full truncate text-center font-display text-sm font-semibold leading-tight sm:text-base">{shortName(fullName)}</span>
        <span className="font-display text-xs font-medium leading-none">{meta.short}</span>
      </button>
      {warning !== "none" && (
        <span aria-hidden
          className={`pointer-events-none absolute left-0.5 top-0.5 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border-[1.5px] bg-surface px-1 font-display text-xs font-semibold leading-none ${warning === "warning" ? "border-warn-alert text-warn-alert" : "border-warn-watch text-warn-watch"}`}>
          <TriangleAlert size={12} strokeWidth={2.5} />
          {absences ? <span className="tabular-nums">{absences}</span> : null}
        </span>
      )}
      {!disabled && (
        <button aria-label={`Mở lựa chọn cho ${fullName}`} onClick={onLongPress}
          className={OPTIONS_CLASS}>
          <span aria-hidden className={OPTIONS_DOT}><Ellipsis size={16} strokeWidth={2.5} /></span>
        </button>
      )}
    </div>
  );
}
