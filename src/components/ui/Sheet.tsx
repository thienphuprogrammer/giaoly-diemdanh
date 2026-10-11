"use client";
import { useEffect, useRef } from "react";

/**
 * Bảng trượt từ dưới lên: nền mờ bấm để đóng, Esc để đóng, focus vào bảng khi mở.
 */
export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button aria-label="Đóng" tabIndex={-1} onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-ink/45 motion-safe:animate-fade-in" />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-[20px] bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-sheet outline-none motion-safe:animate-sheet-in">
        <div aria-hidden className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border-strong" />
        <div className="mx-auto flex max-w-xl flex-col gap-4">{children}</div>
      </div>
    </>
  );
}
