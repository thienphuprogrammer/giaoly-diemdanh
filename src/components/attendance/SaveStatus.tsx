"use client";
import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SaveChip } from "@/lib/attendance/board-state";

/** Chip cạnh tiến độ: "Đang cập nhật…" (dữ liệu cũ, chờ bản mới) / "Đang lưu N…" / "Đã lưu ✓". */
export function SaveStatus({ chip, stale = false }: { chip: SaveChip; stale?: boolean }) {
  if (stale) {
    return (
      <span role="status" aria-live="polite" className="inline-flex min-h-7 items-center gap-1.5 rounded-full bg-surface-muted px-2.5 font-display text-sm font-medium text-ink-soft">
        <LoaderCircle aria-hidden size={14} className="motion-safe:animate-spin" />Đang cập nhật…
      </span>
    );
  }
  if (chip.kind === "idle") return <span role="status" aria-live="polite" className="sr-only" />;
  const saving = chip.kind === "saving";
  return (
    <span role="status" aria-live="polite"
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 font-display text-sm font-medium tabular-nums ${saving ? "bg-surface-muted text-ink-soft" : "bg-st-present-tint text-st-present"}`}>
      {saving ? <LoaderCircle aria-hidden size={14} className="motion-safe:animate-spin" /> : <CircleCheck aria-hidden size={14} />}
      {saving ? `Đang lưu ${chip.count}…` : "Đã lưu ✓"}
    </span>
  );
}

export interface FailureView {
  studentId: string;
  name: string;
  message: string;
}

/** Vùng thông báo dính đáy (trên thanh điều hướng): lỗi lưu từng em kèm "Thử lại", và snackbar hoàn tác. */
export function SaveToasts({ failures, onRetry, onDismiss, undo }: {
  failures: readonly FailureView[];
  onRetry: (studentId: string) => void;
  onDismiss: (studentId: string) => void;
  undo: { text: string; onUndo: () => void; onClose: () => void } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const visible = failures.length > 0 || !!undo;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  if (!visible) return null;
  return (
    <>
    {/* Chừa chỗ dưới cùng của trang bằng đúng chiều cao vùng thông báo để không che các dòng cuối. */}
    <div aria-hidden style={{ height }} />
    <div ref={box} className="pointer-events-none fixed inset-x-0 bottom-safe-18 z-40 px-4 print:hidden">
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        {failures.length > 0 && (
          <ul role="alert" aria-label="Chưa lưu được" className="pointer-events-auto flex max-h-[40dvh] flex-col divide-y divide-warn-alert/20 overflow-y-auto rounded-control border border-warn-alert/30 bg-warn-alert-tint shadow-sheet">
            {failures.map((f) => (
              <li key={f.studentId} className="flex items-center gap-2 px-3 py-2 text-sm text-warn-alert">
                <CircleAlert aria-hidden size={18} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <b>Chưa lưu được cho {f.name}</b> — đã trả về như cũ.{f.message ? ` ${f.message}` : ""}
                </span>
                <button type="button" onClick={() => onRetry(f.studentId)} className="btn btn-secondary btn-sm shrink-0">
                  <RotateCcw aria-hidden size={16} />Thử lại
                </button>
                <button type="button" onClick={() => onDismiss(f.studentId)} aria-label={`Bỏ qua lỗi của ${f.name}`} className="btn btn-ghost btn-icon btn-sm shrink-0">
                  <X aria-hidden size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {undo && (
          <div role="status" className="pointer-events-auto flex items-center gap-2 rounded-control bg-ink px-3 py-2 text-sm font-medium text-surface shadow-sheet">
            <span className="min-w-0 flex-1">{undo.text}</span>
            <button type="button" onClick={undo.onUndo} className="btn btn-sm shrink-0 bg-surface text-ink">
              <Undo2 aria-hidden size={16} />Hoàn tác
            </button>
            <button type="button" onClick={undo.onClose} aria-label="Đóng" className="btn btn-icon btn-sm shrink-0 text-surface">
              <X aria-hidden size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
