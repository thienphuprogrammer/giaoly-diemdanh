"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold text-brand">Điểm danh Giáo lý</h1>
      <p className="mt-1 text-ink-soft">Đăng nhập để mở lớp của bạn</p>
      <form action={action} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input name="email" type="email" autoComplete="username" required
            className="h-12 rounded-xl border border-line bg-card px-4 text-base" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Mật khẩu
          <input name="password" type="password" autoComplete="current-password" required
            className="h-12 rounded-xl border border-line bg-card px-4 text-base" />
        </label>
        {state?.error && <p role="alert" className="text-sm text-warn-alert">{state.error}</p>}
        <button disabled={pending}
          className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">
          {pending ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
      </form>
    </main>
  );
}
