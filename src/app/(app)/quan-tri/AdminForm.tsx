"use client";

import { useActionState, useRef, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { Sheet } from "@/components/ui/Sheet";
import type { FormState } from "@/server/form-state";
import { administerAction } from "./actions";

export function AdminForm({ intent, children, submitLabel, confirmation, sensitive = false, disabled = false }: {
  intent: string;
  children: React.ReactNode;
  submitLabel: string;
  confirmation?: string;
  sensitive?: boolean;
  disabled?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [asking, setAsking] = useState(false);
  const [state, run, pending] = useActionState(async (prev: FormState, fd: FormData): Promise<FormState> => {
    confirmed.current = false;
    setAsking(false);
    try {
      return await administerAction(prev, fd);
    } catch {
      return { error: "Không lưu được. Kiểm tra kết nối rồi thử lại." };
    }
  }, undefined);

  return (
    <>
      <form ref={form} action={run} className="min-w-0" onSubmit={(event) => {
        if (confirmation && !confirmed.current) {
          event.preventDefault();
          setAsking(true);
        }
      }}>
        <input type="hidden" name="intent" value={intent} />
        <fieldset disabled={pending || disabled} className="grid min-w-0 gap-3">
          {children}
          {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
          {state?.ok && <Notice tone="success" role="status">Đã lưu thay đổi</Notice>}
          <button className={`btn min-h-11 justify-self-start ${sensitive ? "btn-danger" : "btn-primary"}`} disabled={pending || disabled}>
            {pending ? "Đang lưu…" : submitLabel}
          </button>
        </fieldset>
      </form>
      {asking && confirmation && <Sheet label={`Xác nhận: ${submitLabel}`} onClose={() => setAsking(false)}>
        <h2 className="text-lg font-semibold">{submitLabel}?</h2>
        <p className="text-ink-soft">{confirmation}</p>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Huỷ</button>
          <button type="button" className={`btn ${sensitive ? "btn-danger" : "btn-primary"}`} onClick={() => {
            confirmed.current = true;
            setAsking(false);
            form.current?.requestSubmit();
          }}>Xác nhận</button>
        </div>
      </Sheet>}
    </>
  );
}
