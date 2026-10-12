"use client";
import { ArrowRightLeft } from "lucide-react";
import { useActionState, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { FormState } from "@/server/form-state";

interface Props {
  gradeId: string;
  gradeName: string;
  nextGradeId: string | null;
  options: { id: string; name: string }[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

/**
 * Khối kế tiếp của khối mình: bật lên lớp sang các lớp của khối đó. Đổi giá trị phải bấm xác nhận lần hai vì nó cho phép
 * chuyển em của khối mình vào lớp của khối khác.
 */
export function NextGradeForm({ gradeId, gradeName, nextGradeId, options, action }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  const [choice, setChoice] = useState(nextGradeId ?? "");
  const [confirming, setConfirming] = useState(false);
  const chosen = options.find((o) => o.id === choice);
  const changed = choice !== (nextGradeId ?? "");
  return (
    <form action={run} onSubmit={() => setConfirming(false)} className="card grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <ArrowRightLeft aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Khối kế tiếp của {gradeName}</h3>
          <p className="mt-0.5 text-sm text-ink-soft">Khi đã chọn, bạn có thể cho em lên lớp sang các lớp của khối đó. Không chọn thì chỉ lên lớp trong khối.</p>
        </div>
      </div>
      <input type="hidden" name="gradeId" value={gradeId} />
      <input type="hidden" name="nextGradeId" value={choice} />
      <Field label="Khối kế tiếp">
        <select value={choice} onChange={(e) => { setChoice(e.target.value); setConfirming(false); }} className="input">
          <option value="">Không có (chỉ lên lớp trong khối)</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      {confirming && (
        <Notice tone="warning" role="status">
          {chosen
            ? <>Bạn sẽ chuyển được thiếu nhi của {gradeName} vào các lớp của <b>{chosen.name}</b>. Bạn không xem được thêm gì của khối đó. Bấm “Xác nhận” để lưu.</>
            : <>Bỏ khối kế tiếp: từ giờ chỉ lên lớp trong {gradeName}. Bấm “Xác nhận” để lưu.</>}
        </Notice>
      )}
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      {state?.ok && !changed && <Notice tone="success" role="status">Đã lưu khối kế tiếp</Notice>}
      {confirming ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-lg btn-secondary" onClick={() => setConfirming(false)}>Huỷ</button>
          <button disabled={pending} className="btn btn-lg btn-primary">Xác nhận</button>
        </div>
      ) : (
        <button type="button" disabled={!changed || pending} onClick={() => setConfirming(true)} className="btn btn-lg btn-primary w-full">Lưu khối kế tiếp</button>
      )}
    </form>
  );
}
