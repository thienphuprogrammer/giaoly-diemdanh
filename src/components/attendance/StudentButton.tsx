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

export function StudentButton({ fullName, status, warning, failed, disabled, onTap, onLongPress }: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fired = useRef(false);
  const stop = () => clearTimeout(timer.current);
  return (
    <button
      disabled={disabled}
      aria-label={`${fullName}: ${status ? STATUS_LABEL[status] : "chưa điểm danh"}`}
      onPointerDown={() => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, LONG_MS); }}
      onPointerUp={() => { stop(); if (!fired.current) onTap(); }}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative flex h-16 w-16 touch-manipulation select-none items-center justify-center rounded-xl border-2 text-xs font-semibold ${status ? STATUS_CLASS[status] : NONE_CLASS} ${failed ? "ring-2 ring-warn-alert ring-offset-2" : ""}`}
    >
      {shortName(fullName)}
      {warning !== "none" && (
        <span aria-label={warning === "warning" ? "Cảnh báo vắng" : "Đã vắng 1 buổi"}
          className={`absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card text-[10px] font-bold text-white ${warning === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
          {warning === "warning" ? "!" : "1"}
        </span>
      )}
    </button>
  );
}
