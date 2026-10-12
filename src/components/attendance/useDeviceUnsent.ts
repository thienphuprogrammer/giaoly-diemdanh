"use client";
import { useCallback, useSyncExternalStore } from "react";
import { countUnsentInQueue, localStore, queueStorageKey } from "@/lib/attendance/persist-queue";

/** Đọc lại khi tab hiện lại, khi trang được khôi phục (bfcache) và khi tab khác (máy quét) ghi hàng chờ. */
function subscribe(notify: () => void) {
  const onVisible = () => { if (document.visibilityState === "visible") notify(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", notify);
  window.addEventListener("pageshow", notify);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", notify);
    window.removeEventListener("pageshow", notify);
  };
}

/**
 * Số lượt quét chưa gửi (đang gửi / chưa gửi được; không tính "cần chọn") của người này cho buổi này, trong hàng chờ
 * bền trên MÁY NÀY. Các em đó trông như "chưa điểm danh" trên bảng dù đã được quét. Bộ nhớ hỏng/bị chặn => 0.
 */
export function useDeviceUnsent(userId: string, sessionId: string): number {
  const snapshot = useCallback(() => {
    try {
      return countUnsentInQueue(localStore(), queueStorageKey(userId, sessionId), Date.now());
    } catch {
      return 0;
    }
  }, [userId, sessionId]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
