import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/nav/LogoutButton";
import { PushToggle } from "@/components/push/PushToggle";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Pill";
import { deleteSession, requireUser } from "@/lib/auth/dal";
import { vapidPublicKeyFromEnv } from "@/lib/push/vapid";
import { changePasswordAction, sendTestPushAction, subscribePushAction, unsubscribePushAction } from "./actions";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function AccountPage() {
  const user = await requireUser();
  async function logout() {
    "use server";
    await deleteSession();
    redirect("/login");
  }
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Tài khoản</h1>
      <div className="card flex items-center gap-4 p-4">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-display text-lg font-semibold">{user.name}</p>
          <p className="break-all text-sm text-ink-soft">{user.email}</p>
          {(user.isAdmin || user.isGradeHead) && <Pill tone="action" icon={ShieldCheck} className="mt-2">{user.isAdmin ? "Quản trị viên" : "Trưởng khối"}</Pill>}
        </div>
      </div>
      {/* Khoá công khai đọc từ biến môi trường lúc chạy (không phải NEXT_PUBLIC_*): đổi khoá không cần build lại. */}
      <PushToggle userId={user.id} publicKey={vapidPublicKeyFromEnv()} subscribe={subscribePushAction} unsubscribe={unsubscribePushAction} sendTest={sendTestPushAction} />
      <p className="-mt-3 px-1 text-sm text-ink-soft" data-testid="reminder-help">
        <span className="font-semibold text-ink">Nhắc việc:</span> khi đã bật thông báo, GLV được nhắc nếu 30 phút sau giờ học
        (đặt ở trang lớp) mà buổi hôm nay chưa điểm danh; trưởng khối được báo khi có em chạm ngưỡng cảnh báo vắng học hoặc
        vắng lễ (mỗi em một lần mỗi học kỳ). Thông báo chỉ ghi tên lớp, không ghi tên các em.
      </p>
      <ChangePasswordForm action={changePasswordAction} />
      <LogoutButton userId={user.id} action={logout} unsubscribePush={unsubscribePushAction} />
    </section>
  );
}
