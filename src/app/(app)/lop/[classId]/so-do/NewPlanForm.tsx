"use client";
import { Plus } from "lucide-react";
import { useActionState } from "react";
import { BlankCard, TemplateCard } from "@/components/seating/TemplateCard";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { TEMPLATES } from "@/lib/seating/templates";
import type { FormState } from "@/server/form-state";

interface Props {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  studentCount: number;
}

/** Đặt tên rồi chạm một mẫu để tạo sơ đồ: mỗi thẻ là nút gửi form với templateId riêng (rỗng = sơ đồ trống). */
export function NewPlanForm({ action, studentCount }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="card grid gap-4 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <Plus aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Tạo sơ đồ mới</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Đặt tên (ví dụ: phòng học chính), rồi chạm một mẫu bố cục. Sau đó vẫn chỉnh được.</p>
        </div>
      </div>
      <Field label="Tên sơ đồ">
        <input name="name" required maxLength={60} autoComplete="off" className="input" />
      </Field>
      <p className="text-sm text-ink-soft">
        Lớp hiện có <span className="font-display font-semibold tabular-nums text-ink">{studentCount} em</span>. Phía trên của hình là bảng.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          <TemplateCard key={t.id} template={t} studentCount={studentCount} type="submit" name="templateId" value={t.id} disabled={pending} />
        ))}
        <BlankCard type="submit" name="templateId" value="" disabled={pending} />
      </div>
      {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
    </form>
  );
}
