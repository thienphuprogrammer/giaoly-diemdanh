"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { guardedNavigation } from "@/lib/leave-guard";

/**
 * Khi `blocking` > 0: bật `beforeunload` và chặn các link trong app (bắt ở pha capture trên document,
 * trước khi <Link> của Next xử lý) để hỏi lại. Khi hết lượt chờ trong lúc đang hỏi thì tự đi tiếp.
 * Không chặn được nút Back của trình duyệt.
 */
export function useLeaveGuard(blocking: number) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    if (blocking === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // trình duyệt cũ chỉ hỏi khi có returnValue
    };
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = guardedNavigation({
        href: a.href, target: a.target, download: a.hasAttribute("download"), button: e.button,
        modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey, defaultPrevented: e.defaultPrevented,
      }, window.location.href);
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(to);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", onClick, true);
    };
  }, [blocking]);

  // Đã lưu xong trong lúc đang hỏi: tự đi tiếp (bảng hỏi đóng khi trang này bị gỡ).
  const continued = useRef<string | null>(null);
  const leave = useCallback(() => {
    if (!target) return;
    continued.current = target;
    setTarget(null);
    router.push(target);
  }, [router, target]);
  const stay = useCallback(() => {
    continued.current = null;
    setTarget(null);
  }, []);

  useEffect(() => {
    if (!target || blocking > 0 || continued.current === target) return;
    continued.current = target;
    router.push(target);
  }, [target, blocking, router]);

  return { target, leave, stay };
}
