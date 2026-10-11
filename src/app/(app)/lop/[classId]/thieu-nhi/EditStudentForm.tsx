"use client";
import { useActionState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { FormState } from "@/server/form-state";
import { updateStudentAction } from "./actions";

export interface EditableStudent {
  id: string;
  saintName: string | null;
  fullName: string;
  birthDate: string | null;
  parentPhone: string | null;
  note: string | null;
}

export function EditStudentForm({ classId, student, onDone }: { classId: string; student: EditableStudent; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    try {
      const next = await updateStudentAction(classId, student.id, prev, fd);
      if (next?.ok) onDone();
      return next;
    } catch {
      return { error: "Không lưu được. Kiểm tra kết nối và thử lại." };
    }
  }, undefined);
  return (
    <form action={action} className="grid gap-4 bg-action-tint/50 p-4">
      <h3 className="text-base font-semibold">Sửa thông tin</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tên thánh"><input name="saintName" defaultValue={student.saintName ?? ""} className="input" /></Field>
        <Field label="Họ và tên" required><input name="fullName" defaultValue={student.fullName} required className="input" /></Field>
        <Field label="Ngày sinh"><input name="birthDate" type="date" defaultValue={student.birthDate ?? ""} className="input" /></Field>
        <Field label="SĐT phụ huynh"><input name="parentPhone" inputMode="tel" defaultValue={student.parentPhone ?? ""} className="input" /></Field>
        <Field label="Ghi chú" className="sm:col-span-2"><input name="note" defaultValue={student.note ?? ""} className="input" /></Field>
      </div>
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <button disabled={pending} className="btn btn-primary btn-lg">Lưu</button>
        <button type="button" onClick={onDone} disabled={pending} className="btn btn-secondary btn-lg">Hủy</button>
      </div>
    </form>
  );
}
