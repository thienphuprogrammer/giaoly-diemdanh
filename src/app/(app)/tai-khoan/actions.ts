"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { createSession, requireUser } from "@/lib/auth/dal";
import { checkVapid } from "@/lib/push/vapid";
import { passwordChangeLimiter, pushSubscribeLimiter, pushTestLimiter } from "@/server/http/limiter";
import type { ActionResult } from "@/server/result";
import { changePassword, type ChangePasswordState } from "@/server/services/account";
import { sendTestPush, subscribePush, unsubscribePush } from "@/server/services/push";

/**
 * Thông báo đẩy của CHÍNH người dùng đang đăng nhập (spec §4). Server Action: Next tự kiểm Origin (chống CSRF);
 * người dùng lấy từ phiên, đối số từ trình duyệt chỉ là dữ liệu đăng ký và đều được kiểm lại ở service.
 */
export async function subscribePushAction(subscription: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const userAgent = (await headers()).get("user-agent");
  return subscribePush(db, user, subscription, { limiter: pushSubscribeLimiter, userAgent });
}

export async function unsubscribePushAction(endpoint: unknown): Promise<ActionResult> {
  const user = await requireUser();
  return unsubscribePush(db, user, { endpoint }, { limiter: pushSubscribeLimiter });
}

export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  const user = await requireUser();
  const vapid = checkVapid(process.env);
  return sendTestPush(db, user, { limiter: pushTestLimiter, vapid: vapid.status === "ok" ? vapid.config : null });
}

/**
 * Người dùng tự đổi mật khẩu. Thành công thì mọi phiên khác bị thu hồi (DAL so `sat` với `password_changed_at`);
 * thiết bị này được cấp lại phiên với `sat` = mốc đổi nên vẫn đăng nhập. Không bao giờ trả lại/ghi log mật khẩu.
 */
export async function changePasswordAction(_prev: ChangePasswordState, formData: FormData): Promise<ChangePasswordState> {
  const user = await requireUser();
  const result = await changePassword(db, user, {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  }, { limiter: passwordChangeLimiter });
  if (!result.ok) return { error: result.error, field: result.field };
  await createSession(user.id, Math.floor(result.changedAt.getTime() / 1000), result.sessionVersion);
  revalidatePath("/tai-khoan");
  return { ok: true };
}
