"use client";
import { AlarmClock } from "lucide-react";
import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { WEEKDAY_LABELS } from "@/lib/class-schedule";
import type { FormState } from "@/server/form-state";

interface Props {
  classId: string;
  meetsOn: number | null;
  meetsAt: string | null;
  label: string | null;
  canEdit: boolean;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

/** Lịch học của lớp: ai đọc được lớp đều thấy; GLV được phân công và trưởng khối sửa/xoá. Trống = không nhắc việc. */
export function ScheduleForm({ classId, meetsOn, meetsAt, label, canEdit, action }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      <AlarmClock aria-hidden size={18} className="shrink-0 text-action" />
      <span className="min-w-0">Lịch học: <span className="font-medium text-ink">{label ?? "chưa đặt"}</span></span>
    </span>
  );
  if (!canEdit) return <p className="card px-4 py-3 text-sm text-ink-soft">{summary}</p>;
  return (
    <details className="card group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm text-ink-soft">
        {summary}
        <span className="shrink-0 font-medium text-action group-open:hidden">Sửa</span>
      </summary>
      <form action={run} className="grid gap-4 border-t border-border p-4">
        <input type="hidden" name="classId" value={classId} />
        <p className="text-sm text-ink-soft">Dùng để nhắc mở buổi điểm danh. Để trống nếu lớp không học cố định.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Thứ">
            <select key={`d${meetsOn}`} name="meetsOn" defaultValue={meetsOn ?? ""} className="input">
              <option value="">—</option>
              {WEEKDAY_LABELS.map((day, i) => <option key={day} value={i}>{day}</option>)}
            </select>
          </Field>
          <Field label="Giờ bắt đầu">
            <input key={`t${meetsAt}`} name="meetsAt" type="time" step={60} defaultValue={meetsAt ?? ""} className="input" />
          </Field>
        </div>
        {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
        {state?.ok && <Notice tone="success" role="status">Đã lưu lịch học</Notice>}
        <div className="grid grid-cols-2 gap-2">
          <button name="intent" value="save" disabled={pending} className="btn btn-lg btn-primary w-full">Lưu lịch</button>
          <button name="intent" value="clear" disabled={pending || label === null} className="btn btn-lg btn-secondary w-full">Xoá lịch</button>
        </div>
      </form>
    </details>
  );
}
