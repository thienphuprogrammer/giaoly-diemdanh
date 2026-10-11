"use client";
import { useActionState } from "react";
import type { FormState } from "@/server/form-state";
import { updateStudentAction } from "./actions";

const input = "h-12 rounded-xl border border-line bg-card px-4 text-base";

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
    <form action={action} className="grid gap-3 p-4">
      <input name="saintName" aria-label="Tên thánh" placeholder="Tên thánh" defaultValue={student.saintName ?? ""} className={input} />
      <input name="fullName" aria-label="Họ và tên" placeholder="Họ và tên *" defaultValue={student.fullName} required className={input} />
      <input name="birthDate" type="date" aria-label="Ngày sinh" defaultValue={student.birthDate ?? ""} className={input} />
      <input name="parentPhone" inputMode="tel" aria-label="SĐT phụ huynh" placeholder="SĐT phụ huynh" defaultValue={student.parentPhone ?? ""} className={input} />
      <input name="note" aria-label="Ghi chú" placeholder="Ghi chú" defaultValue={student.note ?? ""} className={input} />
      {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="h-12 flex-1 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">Lưu</button>
        <button type="button" onClick={onDone} disabled={pending} className="h-12 rounded-xl border border-line px-5 disabled:opacity-60">Hủy</button>
      </div>
    </form>
  );
}
