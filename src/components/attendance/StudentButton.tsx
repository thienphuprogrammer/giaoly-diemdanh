"use client";
import { useRef } from "react";
import { NONE_CLASS, STATUS_CLASS, STATUS_LABEL } from "@/lib/attendance/ui";
import type { AttendanceStatus, WarningLevel } from "@/lib/attendance/warning";
import { shortName } from "@/lib/students/short-name";

interface Props {
  fullName: string;
  status: AttendanceStatus | null;
  warning: WarningLevel;
  failed?: boolean;
  disabled?: boolean;
  onTap: () => void;
  onLongPress: () => void;
}

const LONG_MS = 500;
const CLICK_GUARD_MS = 60;
// Phải nằm HOÀN TOÀN trong khung 64px của ô ghế (không dùng offset âm): nếu tràn ra ngoài sẽ che
// góc ghế bên cạnh và gây mở nhầm bảng chọn của em khác.
const OPTIONS_CLASS =
  "absolute right-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-card text-xs leading-none text-ink-soft";

export function StudentButton({ fullName, status, warning, failed, disabled, onTap, onLongPress }: Props) {
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
  return (
    <div className="relative h-16 w-16">
      <button
        disabled={disabled}
        aria-label={`${fullName}: ${status ? STATUS_LABEL[status] : "chưa điểm danh"}${warningText}`}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={() => { if (fired.current) { fired.current = false; return; } onTap(); }}
        onContextMenu={(e) => e.preventDefault()}
        className={`flex h-16 w-16 touch-manipulation select-none items-center justify-center rounded-xl border-2 text-xs font-semibold ${status ? STATUS_CLASS[status] : NONE_CLASS} ${failed ? "ring-2 ring-warn-alert ring-offset-2" : ""}`}
      >
        {shortName(fullName)}
      </button>
      {warning !== "none" && (
        <span aria-hidden className={`pointer-events-none absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white ${warning === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
          {warning === "warning" ? "!" : "1"}
        </span>
      )}
      {!disabled && (
        <button aria-label={`Mở lựa chọn cho ${fullName}`} onClick={onLongPress}
          className={OPTIONS_CLASS}>
          <span aria-hidden>⋯</span>
        </button>
      )}
    </div>
  );
}
