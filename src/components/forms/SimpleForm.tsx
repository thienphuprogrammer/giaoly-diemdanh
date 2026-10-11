"use client";
import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { FormState } from "@/server/form-state";

interface FieldSpec { name: string; label: string; type?: string; autoComplete?: string; minLength?: number; maxLength?: number; options?: { value: string; label: string }[] }

interface Props {
  title: string;
  fields: FieldSpec[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  description?: string;
  /** Phần tử biểu tượng (vd. <Plus aria-hidden size={20} />): truyền phần tử, không truyền hàm, vì form là Client Component. */
  icon?: React.ReactNode;
  /** "sensitive": thao tác nhạy cảm (đặt lại mật khẩu) — viền và nút màu cảnh báo. */
  tone?: "default" | "sensitive";
}

export function SimpleForm({ title, fields, action, description, icon, tone = "default" }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  const sensitive = tone === "sensitive";
  return (
    <form action={run} className={`card grid gap-4 p-4 ${sensitive ? "border-warn-alert/40" : ""}`}>
      <div className="flex items-start gap-3">
        {icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${sensitive ? "bg-warn-alert-tint text-warn-alert" : "bg-action-tint text-action"}`}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
        </div>
      </div>
      {fields.map((f) => (
        <Field key={f.name} label={f.label}>
          {f.options ? (
            <select name={f.name} required className="input">
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} minLength={f.minLength} maxLength={f.maxLength} required className="input" />
          )}
        </Field>
      ))}
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      {state?.ok && <Notice tone="success" role="status">Đã lưu</Notice>}
      <button disabled={pending} className={`btn btn-lg w-full ${sensitive ? "btn-danger" : "btn-primary"}`}>Lưu</button>
    </form>
  );
}
