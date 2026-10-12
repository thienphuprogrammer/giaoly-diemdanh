"use client";
import type { ActionResult } from "@/server/result";

/** Đăng xuất không bao giờ phải chờ lâu hơn mức này vì việc gỡ thông báo. */
export const RELEASE_TIMEOUT_MS = 2000;

/**
 * Khi đăng xuất: gỡ đăng ký push của THIẾT BỊ NÀY (trình duyệt + máy chủ) để người kế tiếp dùng máy không nhận thông báo
 * của tài khoản cũ. Cố gắng hết sức: mọi lỗi bị nuốt và có hạn chót, không bao giờ chặn đăng xuất.
 */
export async function releasePushDevice(unsubscribe: (endpoint: unknown) => Promise<ActionResult>, timeoutMs = RELEASE_TIMEOUT_MS): Promise<void> {
  const work = (async () => {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    const { endpoint } = sub;
    await Promise.allSettled([unsubscribe(endpoint), sub.unsubscribe()]);
  })().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}
