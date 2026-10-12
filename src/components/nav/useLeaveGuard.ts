"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { armGuard, guardClick, guardLeave, guardPop, initialHistoryGuard, mountGuard, type GuardStep, type LeaveIntent } from "@/lib/history-guard";
import { guardedNavigation } from "@/lib/leave-guard";

export type { LeaveIntent } from "@/lib/history-guard";

/** Đánh dấu mục lịch sử lính gác (Next giữ state tùy biến khi tải lại trang), để không đặt chồng thêm mục. */
const SENTINEL_KEY = "__ddGuard";
const pushSentinel = () => window.history.pushState({ ...window.history.state, [SENTINEL_KEY]: true }, "", window.location.href);

/**
 * Khi `blocking` > 0: bật `beforeunload`, chặn các link trong app (bắt ở pha capture trên document, trước khi
 * <Link> của Next xử lý) và chặn nút Back của trình duyệt/Android (lính gác lịch sử, xem `history-guard.ts`)
 * để hỏi lại. Khi hết lượt chờ trong lúc đang hỏi thì tự đi tiếp.
 * Khi đã lưu hết mà lính gác còn trong lịch sử, bấm link vẫn bị bắt để rời qua lính gác (không để lại mục trùng URL
 * làm lần Back sau "chết").
 *
 * `navigate: "replace"` để trang này không còn trong lịch sử sau khi rời đi (màn quét: Back không quay lại máy quét).
 * `go(href)` cho nút điều hướng tự vẽ (không phải <a>): đi ngay nếu không còn gì chờ, ngược lại thì hỏi.
 */
export function useLeaveGuard(blocking: number, opts: { navigate?: "push" | "replace" } = {}) {
  const router = useRouter();
  const replace = opts.navigate === "replace";
  const [target, setTarget] = useState<LeaveIntent | null>(null);
  const hist = useRef(initialHistoryGuard);
  const blockingRef = useRef(blocking);
  /** Đã chọn rời trang (hoặc chủ động tải trang khác): không hỏi `beforeunload` nữa. */
  const bypass = useRef(false);

  const navigate = useCallback((href: string, hard?: boolean) => {
    if (hard) {
      bypass.current = true;
      window.location.assign(href);
    } else if (replace) router.replace(href);
    else router.push(href);
  }, [router, replace]);

  const run = useCallback((step: GuardStep) => {
    hist.current = step.state;
    const effect = step.effect;
    switch (effect.kind) {
      case "push":
        pushSentinel();
        return;
      case "prompt":
        pushSentinel();
        setTarget({ kind: "back" });
        return;
      case "back":
        window.history.back();
        return;
      case "go":
        window.history.go(effect.delta);
        return;
      case "navigate":
        navigate(effect.href, effect.hard);
        return;
      case "none":
        return;
    }
  }, [navigate]);

  // Mở trang trên chính mục lính gác (tải lại trang khi còn hàng chờ): đã gác sẵn, không đặt chồng thêm.
  useEffect(() => {
    const state: unknown = window.history.state;
    if (typeof state === "object" && state !== null && (state as Record<string, unknown>)[SENTINEL_KEY] === true && !hist.current.exiting) {
      hist.current = mountGuard(true);
    }
  }, []);

  // Đặt lính gác lịch sử khi bắt đầu có việc chưa lưu (một lần; ref giữ qua lần chạy kép của StrictMode).
  useEffect(() => {
    blockingRef.current = blocking;
    run(armGuard(hist.current, blocking > 0));
  }, [blocking, run]);

  useEffect(() => {
    const onPop = () => {
      const step = guardPop(hist.current, blockingRef.current > 0);
      if (step.effect.kind !== "navigate") return run(step);
      // Next 16.4 xử lý cùng sự kiện popstate (ACTION_RESTORE cho mục vừa về) sau listener của nó; điều hướng ngay
      // trong listener này bị lần khôi phục đó đè (thấy trong E2E). Đợi một macrotask cho việc đó xong rồi mới đi.
      const { href, hard } = step.effect;
      hist.current = step.state;
      window.setTimeout(() => navigate(href, hard), 0);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [run, navigate]);

  useEffect(() => {
    if (blocking === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (bypass.current) return;
      e.preventDefault();
      e.returnValue = ""; // trình duyệt cũ chỉ hỏi khi có returnValue
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [blocking]);

  const continued = useRef<LeaveIntent | null>(null);
  const proceed = useCallback((intent: LeaveIntent) => {
    continued.current = intent;
    setTarget(null);
    run(guardLeave(hist.current, intent));
  }, [run]);

  // Bắt link luôn được gắn; quyết định đọc từ ref (còn việc chờ => hỏi; còn lính gác => rời qua lính gác).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const decision = guardClick(hist.current, blockingRef.current > 0);
      if (decision === "ignore") return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const to = guardedNavigation({
        href: a.href, target: a.target, download: a.hasAttribute("download"), button: e.button,
        modifier: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey, defaultPrevented: e.defaultPrevented,
      }, window.location.href);
      if (!to) return;
      e.preventDefault();
      e.stopPropagation();
      if (decision === "prompt") setTarget({ kind: "href", href: to });
      else proceed({ kind: "href", href: to });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [proceed]);

  const leave = useCallback(() => { if (target) proceed(target); }, [target, proceed]);
  const stay = useCallback(() => {
    continued.current = null;
    setTarget(null);
  }, []);

  /** Nút điều hướng tự vẽ: đi ngay khi không còn gì chờ, ngược lại mở bảng hỏi. */
  const go = useCallback((href: string) => {
    if (blockingRef.current > 0) setTarget({ kind: "href", href });
    else proceed({ kind: "href", href });
  }, [proceed]);

  /** Tải hẳn trang khác (vd. đăng nhập lại) không hỏi; bỏ lính gác trước. Dữ liệu cần giữ phải đã được lưu bền. */
  const hardNavigate = useCallback((href: string) => {
    bypass.current = true;
    proceed({ kind: "href", href, hard: true });
  }, [proceed]);

  // Đã lưu xong trong lúc đang hỏi: tự đi tiếp (bảng hỏi đóng khi trang này bị gỡ).
  useEffect(() => {
    if (!target || blocking > 0 || continued.current === target) return;
    continued.current = target;
    run(guardLeave(hist.current, target));
  }, [target, blocking, run]);

  return { target, leave, stay, go, hardNavigate };
}
