"use server";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { checkVapid } from "@/lib/push/vapid";
import { pushSubscribeLimiter, pushTestLimiter } from "@/server/http/limiter";
import type { ActionResult } from "@/server/result";
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
