"use client";
import { useEffect, useRef } from "react";
import { lockBodyScroll } from "@/lib/ui/body-scroll-lock";

/**
 * Bảng trượt trên điện thoại, hộp thoại giữa màn hình máy tính.
 * Dialog gốc giữ focus bên trong và làm nền không tương tác khi mở.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    dialog.focus();
    const unlock = lockBodyScroll(document.body);
    return () => {
      dialog.close();
      unlock();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
      <dialog ref={ref} tabIndex={-1} aria-modal="true" aria-label={label}
        onCancel={(e) => { e.preventDefault(); onClose(); }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        className="fixed inset-x-0 bottom-0 top-auto z-50 m-0 max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-t-[20px] bg-surface p-0 text-ink outline-none backdrop:bg-ink/45 motion-safe:animate-sheet-in lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-1/2 lg:max-h-[85dvh] lg:w-[min(36rem,calc(100%-4rem))] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-card">
        <div className="px-4 pb-safe-4 pt-2 lg:p-6">
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border-strong lg:hidden" />
        <div className="mx-auto flex max-w-xl flex-col gap-4">{children}</div>
        </div>
      </dialog>
  );
}
