"use client";
import { Check, CircleDashed, X } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { StatusPill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { STATUS_META } from "@/components/ui/status";
import { STATUS_LABEL } from "@/lib/attendance/ui";
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
  return (
    <Sheet label={`Điểm danh ${name}`} onClose={onClose}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl font-semibold">{name}</h2>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-ink-soft">
            Hiện tại: <StatusPill status={current ?? "none"} label={current ? STATUS_LABEL[current] : "Chưa điểm danh"} />
          </div>
        </div>
        <button onClick={onClose} aria-label="Đóng" className="btn btn-ghost btn-icon -mr-2 -mt-1 shrink-0">
          <X aria-hidden size={22} />
        </button>
      </div>
      <Field label="Lý do (không bắt buộc)" hint="Nhập trước khi chọn trạng thái, ví dụ: ốm, về quê.">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {ORDER.map((s) => {
          const meta = STATUS_META[s];
          const Icon = meta.icon;
          const selected = current === s;
          return (
            <button key={s} onClick={() => onPick(s, text.trim() || null)} aria-pressed={selected}
              className={`relative flex min-h-16 items-center gap-2.5 rounded-control border-2 px-3 py-2 text-left font-display text-base font-semibold leading-tight transition-[transform,background-color] duration-150 active:scale-[0.98] ${selected ? meta.solid : meta.tint}`}>
              <Icon aria-hidden size={22} strokeWidth={2.25} className="shrink-0" />
              <span className="min-w-0 flex-1">{STATUS_LABEL[s]}</span>
              {selected && <Check aria-hidden size={18} strokeWidth={3} className="shrink-0" />}
            </button>
          );
        })}
      </div>
      <button onClick={() => onPick(null, null)} className="btn btn-secondary w-full">
        <CircleDashed aria-hidden size={20} />
        Bỏ điểm danh (chưa điểm danh)
      </button>
    </Sheet>
  );
}
