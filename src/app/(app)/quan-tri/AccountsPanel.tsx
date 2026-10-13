import { ChevronRight, KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import type { SystemAdminOverview } from "@/server/services/system-admin";
import { AccountForm } from "./AccountForm";
import { ActorPasswordField } from "./ActorPasswordField";
import { AdminForm } from "./AdminForm";

const ROLE_LABELS = { admin: "Quản trị viên", head: "Khối trưởng", catechist: "Giáo lý viên" };

export function AccountsPanel({ overview, actorId }: { overview: SystemAdminOverview; actorId: string }) {
  const { accounts, grades, schoolYears } = overview;
  return (
    <section aria-labelledby="admin-accounts" className="grid min-w-0 gap-4">
      <div><h2 id="admin-accounts" className="text-xl font-semibold">Tài khoản giáo lý viên và khối trưởng</h2><p className="mt-1 text-sm text-ink-soft">Quản lý vai trò, khối phụ trách và quyền đăng nhập. Việc đổi quyền có hiệu lực ngay.</p></div>
      <details className="card group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold hover:bg-surface-muted">Tạo tài khoản mới<ChevronRight aria-hidden size={18} className="transition-transform group-open:rotate-90" /></summary>
        <div className="border-t border-border p-4"><AccountForm grades={grades} /></div>
      </details>
      {accounts.length === 0 ? <p className="card p-4 text-ink-soft">Không có tài khoản phù hợp với bộ lọc.</p> : (
        <ul aria-label="Danh sách tài khoản" className="grid gap-3">
          {accounts.map((account) => {
            const isSelf = account.id === actorId;
            return (
              <li key={account.id} className="card min-w-0 overflow-hidden">
                <details className="group">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted">
                    <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{account.name}{isSelf ? " (bạn)" : ""}</span><span className="mt-1 block break-all text-sm text-ink-soft">{account.email}</span><span className="mt-2 flex flex-wrap gap-2"><Pill tone={account.isAdmin ? "action" : "neutral"} icon={account.isAdmin ? ShieldCheck : undefined}>{ROLE_LABELS[account.role]}</Pill><Pill tone={account.isActive ? "neutral" : "alert"}>{account.isActive ? "Đang hoạt động" : "Đã khoá"}</Pill>{account.gradeName && <Pill>{account.gradeName}</Pill>}</span></span>
                    <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="grid gap-5 border-t border-border p-4 xl:grid-cols-2">
                    <div className="grid content-start gap-3"><h3 className="font-semibold">Thông tin và quyền</h3><AccountForm grades={grades} account={account} isSelf={isSelf} /></div>
                    <div className="grid content-start gap-5">
                      <div>
                        <h3 className="font-semibold">Lớp được phân công</h3>
                        {account.assignedClasses.length === 0 ? <p className="mt-2 text-sm text-ink-soft">Chưa phân công lớp. Mở mục Lớp để gán giáo lý viên.</p> : <ul className="mt-2 grid gap-1">
                          {account.assignedClasses.map((cls) => <li key={cls.id}><Link href={`/lop/${cls.id}`} className="inline-flex min-h-11 items-center gap-2 break-words text-sm text-action hover:underline">{cls.name}<span className="text-ink-soft">· {schoolYears.find((year) => year.id === cls.schoolYearId)?.name ?? "Năm học"}</span></Link></li>)}
                        </ul>}
                      </div>
                      {isSelf ? <p className="text-sm text-ink-soft">Để đổi mật khẩu của bạn, mở <Link href="/tai-khoan" className="text-action underline">Tài khoản</Link>. Không thể tự khoá tài khoản đang dùng.</p> : <>
                        <div className="grid gap-3 rounded-control border border-border p-3">
                          <h3 className="flex items-center gap-2 font-semibold"><KeyRound aria-hidden size={18} />Đặt lại mật khẩu</h3>
                          <AdminForm intent="reset-account-password" submitLabel="Đặt lại mật khẩu" sensitive confirmation={`Mật khẩu cũ của ${account.name} sẽ không còn dùng được và các phiên đăng nhập cũ sẽ hết hiệu lực. Gửi mật khẩu mới cho họ trực tiếp.`}>
                            <input type="hidden" name="userId" value={account.id} />
                            <Field label={`Mật khẩu mới (từ ${PASSWORD_MIN_LENGTH} ký tự)`} hint="Tối đa 72 byte, chữ có dấu chiếm nhiều byte."><input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_BYTES} className="input" /></Field>
                            <ActorPasswordField />
                          </AdminForm>
                        </div>
                        <AdminForm intent="set-account-active" submitLabel={account.isActive ? "Khoá tài khoản" : "Mở khoá tài khoản"} sensitive={account.isActive} confirmation={account.isActive ? `${account.name} sẽ bị đăng xuất và không thể đăng nhập. Lịch sử điểm danh và phân công lớp được giữ lại.` : `Cho phép ${account.name} đăng nhập trở lại với vai trò hiện có.`}>
                          <input type="hidden" name="userId" value={account.id} /><input type="hidden" name="isActive" value={String(!account.isActive)} />
                          {account.isAdmin && <ActorPasswordField />}
                        </AdminForm>
                      </>}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
