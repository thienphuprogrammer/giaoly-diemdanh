"use client";
import { useActionState, useRef } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { FormState } from "@/server/form-state";
import { addStudentAction } from "./actions";

export function StudentForm({ classId }: { classId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const next = await addStudentAction(classId, prev, fd);
    if (next?.ok) ref.current?.reset();
    return next;
  }, undefined);
  return (
    <form ref={ref} action={action} className="card grid gap-4 p-4">
      <h2 className="text-lg font-semibold">Thêm thiếu nhi</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên thánh"><input name="saintName" className="input" /></Field>
        <Field label="Họ và tên" required><input name="fullName" required className="input" /></Field>
        <Field label="Ngày sinh"><input name="birthDate" type="date" className="input" /></Field>
        <Field label="SĐT phụ huynh"><input name="parentPhone" inputMode="tel" autoComplete="off" className="input" /></Field>
        <Field label="Ghi chú" className="sm:col-span-2"><input name="note" className="input" /></Field>
      </div>
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      {state?.ok && <Notice tone="success" role="status">Đã thêm. Có thể nhập em tiếp theo.</Notice>}
      <button disabled={pending} className="btn btn-primary btn-lg w-full">Thêm</button>
    </form>
  );
}
