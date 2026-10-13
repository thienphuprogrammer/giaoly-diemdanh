"use client";
import { KeyRound } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import type { ChangePasswordField, ChangePasswordState } from "@/server/services/account";

interface Props {
  action: (prev: ChangePasswordState, fd: FormData) => Promise<ChangePasswordState>;
}

const FIELDS: { name: ChangePasswordField; label: string; autoComplete: "current-password" | "new-password"; hint?: string }[] = [
  { name: "currentPassword", label: "Mật khẩu hiện tại", autoComplete: "current-password" },
  { name: "newPassword", label: "Mật khẩu mới", autoComplete: "new-password", hint: `Ít nhất ${PASSWORD_MIN_LENGTH} ký tự, khác mật khẩu hiện tại.` },
  { name: "confirmPassword", label: "Nhập lại mật khẩu mới", autoComplete: "new-password" },
];

/** Đổi mật khẩu của chính mình. Lỗi hiện ngay dưới ô liên quan (lỗi chung như bị khóa hiện cuối form). */
export function ChangePasswordForm({ action }: Props) {
  const [state, run, pending] = useActionState(action, undefined);
  const [visible, setVisible] = useState(false);
  const id = useId();
  const fieldError = (name: ChangePasswordField) => (state?.error && state.field === name ? state.error : null);
  const generalError = state?.error && !state.field ? state.error : null;
  return (
    <form action={run} className="card grid gap-4 p-4" aria-labelledby={`${id}-title`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-action-tint text-action">
          <KeyRound aria-hidden size={20} />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold">Đổi mật khẩu</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Sau khi đổi, các thiết bị khác đang đăng nhập sẽ bị đăng xuất.</p>
        </div>
      </div>
      {FIELDS.map((f) => {
        const error = fieldError(f.name);
        const describedBy = [f.hint ? `${id}-${f.name}-hint` : null, error ? `${id}-${f.name}-error` : null].filter(Boolean).join(" ") || undefined;
        return (
          <div key={f.name} className="grid gap-1.5">
            <label htmlFor={`${id}-${f.name}`} className="label">{f.label}</label>
            <input
              id={`${id}-${f.name}`} name={f.name} type={visible ? "text" : "password"} autoComplete={f.autoComplete}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} required
              aria-invalid={error ? true : undefined} aria-describedby={describedBy}
              className={`input ${error ? "border-warn-alert" : ""}`}
            />
            {f.hint && <p id={`${id}-${f.name}-hint`} className="text-xs text-ink-muted">{f.hint}</p>}
            {error && <p id={`${id}-${f.name}-error`} role="alert" className="text-sm font-medium text-warn-alert">{error}</p>}
          </div>
        );
      })}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start text-sm text-ink-soft">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="h-5 w-5" />
        Hiện mật khẩu
      </label>
      {generalError && <Notice tone="error" role="alert">{generalError}</Notice>}
      {state?.ok && <Notice tone="success" role="status">Đã đổi mật khẩu. Các thiết bị khác sẽ bị đăng xuất.</Notice>}
      <button disabled={pending} className="btn btn-primary btn-lg w-full">{pending ? "Đang đổi…" : "Đổi mật khẩu"}</button>
    </form>
  );
}
