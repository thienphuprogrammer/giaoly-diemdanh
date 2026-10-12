"use client";
import { Church } from "lucide-react";
import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { MASS_THRESHOLD_MAX, MASS_THRESHOLD_MIN } from "@/lib/attendance/mass-tally";
import type { FormState } from "@/server/form-state";

interface Props {
  gradeId: string;
  threshold: number;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

/** Ngưỡng cảnh báo đi lễ của khối: số tuần vắng lễ trong học kỳ để em hiện ở "Cần chú ý" (nhóm Đi lễ). */
export function MassThresholdForm({ gradeId, threshold, action }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="card grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <Church aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Ngưỡng cảnh báo đi lễ</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Hiện tại: cảnh báo khi một em vắng lễ từ <span className="font-medium tabular-nums text-ink">{threshold}</span> tuần trong học kỳ. Tính riêng với vắng buổi học.
          </p>
        </div>
      </div>
      <input type="hidden" name="gradeId" value={gradeId} />
      <Field label={`Số tuần vắng lễ (${MASS_THRESHOLD_MIN}–${MASS_THRESHOLD_MAX})`}>
        <input key={threshold} name="threshold" type="number" inputMode="numeric" min={MASS_THRESHOLD_MIN} max={MASS_THRESHOLD_MAX} step={1}
          defaultValue={threshold} required className="input" />
      </Field>
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      {state?.ok && <Notice tone="success" role="status">Đã lưu ngưỡng đi lễ</Notice>}
      <button disabled={pending} className="btn btn-lg btn-primary w-full">Lưu ngưỡng</button>
    </form>
  );
}
