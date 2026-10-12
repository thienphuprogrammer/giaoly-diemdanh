"use client";
import { LogIn } from "lucide-react";
import { useActionState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { login } from "./actions";

/** `next` đã được kiểm bằng safeNextPath ở trang; action kiểm lại lần nữa (giá trị form do client gửi). */
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <BrandMark size={64} />
          <h1 className="mt-5 text-2xl font-semibold text-ink">Điểm danh Giáo lý</h1>
          <p className="mt-1.5 text-ink-soft">Đăng nhập để mở lớp của bạn</p>
        </div>
        <form action={action} className="card mt-8 flex flex-col gap-4 p-5">
          {/* Ô ẩn giữ `next` qua các lần đăng nhập sai (form reset không đổi giá trị ô ẩn). */}
          <input type="hidden" name="next" value={next} />
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" inputMode="email" required className="input" />
          </Field>
          <Field label="Mật khẩu">
            <input name="password" type="password" autoComplete="current-password" required className="input" />
          </Field>
          {state?.error && <Notice tone="error" role="alert">{state.error}</Notice>}
          <button disabled={pending} className="btn btn-primary btn-lg mt-1 w-full">
            <LogIn aria-hidden size={20} />
            {pending ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-muted">Quên mật khẩu? Nhờ trưởng khối đặt lại.</p>
      </div>
    </main>
  );
}
