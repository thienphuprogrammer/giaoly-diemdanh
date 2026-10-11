"use client";
import { useActionState } from "react";
import type { FormState } from "@/server/form-state";

interface Field { name: string; label: string; type?: string; options?: { value: string; label: string }[] }

export function SimpleForm({ title, fields, action }: { title: string; fields: Field[]; action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, run, pending] = useActionState(action, undefined);
  const cls = "h-12 rounded-xl border border-line bg-card px-4 text-base";
  return (
    <form action={run} className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      {fields.map((f) => f.options ? (
        <select key={f.name} name={f.name} aria-label={f.label} required className={cls}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input key={f.name} name={f.name} type={f.type ?? "text"} placeholder={f.label} aria-label={f.label} required className={cls} />
      ))}
      {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-brand">Đã lưu</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">Lưu</button>
    </form>
  );
}
