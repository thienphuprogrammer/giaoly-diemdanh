"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { ActorPasswordField } from "./ActorPasswordField";
import { AdminForm } from "./AdminForm";

type Role = "admin" | "head" | "catechist";
type Account = { id: string; name: string; email: string; role: Role; gradeId: string | null };

export function AccountForm({ grades, account, isSelf = false }: {
  grades: { id: string; name: string }[];
  account?: Account;
  isSelf?: boolean;
}) {
  const [role, setRole] = useState<Role>(account?.role ?? "catechist");
  // Mirrors the service rule: creating/granting admin, or editing another admin, needs the actor's own password.
  const needsStepUp = !isSelf && (role === "admin" || account?.role === "admin");
  return (
    <AdminForm intent={account ? "update-account" : "create-account"} submitLabel={account ? "Lưu tài khoản" : "Tạo tài khoản"}>
      {account && <input type="hidden" name="userId" value={account.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Họ tên"><input name="name" autoComplete="name" defaultValue={account?.name} required maxLength={120} className="input" /></Field>
        <Field label="Email"><input name="email" type="email" autoComplete="off" defaultValue={account?.email} required maxLength={254} className="input" /></Field>
      </div>
      <Field label="Vai trò" hint={isSelf ? "Bạn không thể hạ quyền tài khoản đang đăng nhập." : "Quản trị viên quản lý toàn hệ thống; khối trưởng phụ trách một khối."}>
        {isSelf && <input type="hidden" name="role" value={role} />}
        <select name={isSelf ? undefined : "role"} value={role} disabled={isSelf} onChange={(event) => setRole(event.target.value as Role)} className="input">
          <option value="catechist">Giáo lý viên</option>
          <option value="head">Khối trưởng</option>
          <option value="admin">Quản trị viên</option>
        </select>
      </Field>
      {role !== "admin" && <Field label="Khối" hint={role === "head" ? "Khối trưởng phải được phân công một khối." : "Có thể phân công giáo lý viên vào các lớp trong phần quản lý lớp."}>
        <select name="gradeId" defaultValue={account?.gradeId ?? ""} required={role === "head"} className="input">
          <option value="">{role === "head" ? "Chọn khối" : "Chưa phân công khối"}</option>
          {grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
        </select>
      </Field>}
      {!account && <Field label={`Mật khẩu ban đầu (từ ${PASSWORD_MIN_LENGTH} ký tự)`} hint="Giới hạn 72 byte; chữ có dấu chiếm nhiều byte. Gửi mật khẩu cho người dùng trực tiếp.">
        <input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_BYTES} className="input" />
      </Field>}
      {needsStepUp && <ActorPasswordField />}
    </AdminForm>
  );
}
