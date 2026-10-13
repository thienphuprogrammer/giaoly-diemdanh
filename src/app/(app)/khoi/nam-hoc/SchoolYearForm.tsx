"use client";
import { CalendarPlus } from "lucide-react";
import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { SchoolYearDraft } from "@/lib/school-year/defaults";
import type { FormState } from "@/server/form-state";

interface Props {
  defaults: SchoolYearDraft;
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

function TermFields({ n, term }: { n: 1 | 2; term: SchoolYearDraft["term1"] }) {
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-control border border-border p-3">
      <legend className="px-1 text-sm font-semibold">Học kỳ {n}</legend>
      <Field label="Tên học kỳ">
        <input name={`term${n}Name`} defaultValue={term.name} required maxLength={40} className="input" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Bắt đầu">
          <input name={`term${n}Start`} type="date" defaultValue={term.startsOn} required className="input" />
        </Field>
        <Field label="Kết thúc">
          <input name={`term${n}End`} type="date" defaultValue={term.endsOn} required className="input" />
        </Field>
      </div>
    </fieldset>
  );
}

/** Tạo năm học mới với hai học kỳ; mặc định = năm học gần nhất dời một năm (sửa được). */
export function SchoolYearForm({ defaults, action }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="card grid min-w-0 gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <CalendarPlus aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Tạo năm học mới</h3>
          <p className="mt-0.5 text-sm text-ink-soft">
            Năm học dùng chung cho mọi khối. Buổi học và điểm danh của năm cũ giữ nguyên; ứng dụng tự chọn học kỳ theo ngày hôm nay.
          </p>
        </div>
      </div>
      <Field label="Tên năm học">
        <input name="name" defaultValue={defaults.name} required maxLength={40} className="input" />
      </Field>
      <TermFields n={1} term={defaults.term1} />
      <TermFields n={2} term={defaults.term2} />
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      {state?.ok && <Notice tone="success" role="status">Đã tạo năm học</Notice>}
      <button disabled={pending} className="btn btn-lg btn-primary w-full">Tạo năm học</button>
    </form>
  );
}
