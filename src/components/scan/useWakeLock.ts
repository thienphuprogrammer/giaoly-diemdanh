"use client";
import { useEffect } from "react";

interface WakeLockSentinelLike { released: boolean; release(): Promise<void>; addEventListener(type: "release", cb: () => void): void }
interface WakeLockLike { request(type: "screen"): Promise<WakeLockSentinelLike> }

/**
 * Giữ màn hình sáng khi `active` (đang quét). Trình duyệt tự nhả khóa khi tab bị ẩn, nên xin lại khi tab hiện lại.
 * Không hỗ trợ hoặc bị từ chối (pin yếu, chính sách…) thì bỏ qua, không lỗi.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;
    let alive = true;
    let sentinel: WakeLockSentinelLike | null = null;
    /** Đang xin khóa: không xin chồng lần nữa (hai khóa => một khóa bị rò, không bao giờ nhả). */
    let requesting = false;

    const acquire = async () => {
      if (!alive || requesting || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      requesting = true;
      try {
        const next = await wakeLock.request("screen");
        if (!alive) { void next.release().catch(() => undefined); return; }
        sentinel = next;
      } catch { /* bị từ chối: màn hình có thể tự tắt, quét vẫn chạy */ } finally {
        requesting = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
    };
  }, [active]);
}
