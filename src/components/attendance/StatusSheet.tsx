"use client";
import { useEffect, useRef, useState } from "react";
import { STATUS_CLASS, STATUS_LABEL } from "@/lib/attendance/ui";
import type { AttendanceStatus } from "@/lib/attendance/warning";

const ORDER: AttendanceStatus[] = ["present", "late", "absent_excused", "absent_unexcused"];

interface Props {
  name: string;
  current: AttendanceStatus | null;
  reason: string | null;
  onPick: (status: AttendanceStatus | null, reason: string | null) => void;
  onClose: () => void;
}

export function StatusSheet({ name, current, reason, onPick, onClose }: Props) {
  const [text, setText] = useState(reason ?? "");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
    <button aria-label="Đóng" tabIndex={-1} onClick={onClose} className="fixed inset-0 z-20 cursor-default bg-black/30" />
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Điểm danh ${name}`} className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-line bg-card p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl outline-none">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <h2 className="text-lg font-semibold">{name}</h2>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Lý do (không bắt buộc)" maxLength={200}
          className="h-12 rounded-xl border border-line px-4" />
        <div className="grid grid-cols-2 gap-2">
          {ORDER.map((s) => (
            <button key={s} onClick={() => onPick(s, text.trim() || null)} aria-pressed={current === s}
              className={`h-12 rounded-xl border-2 text-sm font-semibold ${current === s ? STATUS_CLASS[s] : "border-line bg-paper"}`}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <button onClick={() => onPick(null, null)} className="h-12 rounded-xl border border-line text-sm">Bỏ điểm danh (chưa điểm danh)</button>
        <button onClick={onClose} className="h-12 rounded-xl text-sm text-ink-soft">Đóng</button>
      </div>
    </div>
    </>
  );
}
