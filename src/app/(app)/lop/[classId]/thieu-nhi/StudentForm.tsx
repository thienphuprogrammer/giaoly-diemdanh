"use client";
import { useActionState, useRef } from "react";
import type { FormState } from "@/server/form-state";
import { addStudentAction } from "./actions";

const input = "h-12 rounded-xl border border-line bg-card px-4 text-base";

export function StudentForm({ classId }: { classId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await addStudentAction(classId, prev, fd);
    if (next?.ok) ref.current?.reset();
    return next;
  }, undefined);
  return (
    <form ref={ref} action={action} className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">Thêm thiếu nhi</h2>
      <input name="saintName" placeholder="Tên thánh" className={input} />
      <input name="fullName" placeholder="Họ và tên *" required className={input} />
      <input name="birthDate" type="date" aria-label="Ngày sinh" className={input} />
      <input name="parentPhone" inputMode="tel" placeholder="SĐT phụ huynh" className={input} />
      <input name="note" placeholder="Ghi chú" className={input} />
      {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">Thêm</button>
    </form>
  );
}
