"use client";
import { Pencil } from "lucide-react";
import { useActionState, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import type { FormState } from "@/server/form-state";
import { updateStudentContactAction } from "../actions";

export function ContactForm({ classId, studentId, parentPhone, note }: {
  classId: string; studentId: string; parentPhone: string | null; note: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    try {
      const next = await updateStudentContactAction(classId, studentId, prev, fd);
      if (next?.ok) setEditing(false);
      return next;
    } catch {
      return { error: "Không lưu được. Kiểm tra kết nối và thử lại." };
    }
  }, undefined);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="btn btn-secondary">
        <Pencil aria-hidden size={20} />Sửa ghi chú và SĐT
      </button>
    );
  }
  return (
    <form action={action} className="card grid gap-4 bg-action-tint/50 p-4">
      <h3 className="text-base font-semibold">Sửa ghi chú và SĐT</h3>
      <Field label="SĐT phụ huynh" hint="Nhập 0901 234 567 hoặc +84 901 234 567; app tự chuẩn hoá. Để trống nếu chưa có.">
        <input name="parentPhone" type="tel" inputMode="tel" autoComplete="off" defaultValue={parentPhone ?? ""} className="input" />
      </Field>
      <Field label="Ghi chú">
        <textarea name="note" rows={3} maxLength={500} defaultValue={note ?? ""} className="input min-h-24 py-2" />
      </Field>
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <button disabled={pending} className="btn btn-primary btn-lg">Lưu</button>
        <button type="button" onClick={() => setEditing(false)} disabled={pending} className="btn btn-secondary btn-lg">Hủy</button>
      </div>
    </form>
  );
}
