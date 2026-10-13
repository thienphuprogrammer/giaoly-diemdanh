import { Field } from "@/components/ui/Field";

/** Step-up: the signed-in admin re-enters their own password for credential resets and admin-privilege changes. */
export function ActorPasswordField() {
  return (
    <Field label="Mật khẩu của bạn" hint="Nhập mật khẩu đăng nhập của bạn để xác nhận thao tác nhạy cảm này." required>
      <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={1024} className="input" />
    </Field>
  );
}
