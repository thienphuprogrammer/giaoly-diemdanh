"use client";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/Notice";
import type { ActionResult } from "@/server/result";
import type { PromotionItem } from "@/server/services/promotions";

const WHEN = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  items: PromotionItem[];
  undo: (input: { promotionId: string }) => Promise<ActionResult<{ restored: number; notRestored: number }>>;
}

function status(p: PromotionItem): { text: string; cls: string } {
  if (p.undone) return { text: "Đã hoàn tác", cls: "bg-surface-muted text-ink-soft" };
  if (p.incoming) return { text: "Chuyển vào", cls: "bg-warn-watch-tint text-warn-watch" };
  if (p.canUndo) return { text: "Hoàn tác được", cls: "bg-action-tint text-action" };
  return { text: "Hết hạn hoàn tác", cls: "bg-surface-muted text-ink-soft" };
}

/** Các lượt lên lớp gần đây của khối; lượt còn trong 24 giờ có nút hoàn tác (hỏi lại một lần). */
export function PromotionHistory({ items, undo }: Props) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function confirmUndo(p: PromotionItem) {
    setBusy(true);
    try {
      const r = await undo({ promotionId: p.id });
      setMessage(r.ok
        ? { tone: "success", text: `Đã trả ${r.data.restored} em về ${p.fromClassName}.${r.data.notRestored > 0 ? ` ${r.data.notRestored} em không trả được vì đã chuyển sang lớp khác.` : ""} Chỗ ngồi cũ không được khôi phục.` }
        : { tone: "error", text: r.error });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Không lưu được. Kiểm tra mạng rồi thử lại." });
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  if (items.length === 0) return <p className="text-sm text-ink-soft">Chưa có lượt lên lớp nào.</p>;
  return (
    <div className="grid gap-3">
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
      <ul aria-label="Các lượt lên lớp" className="card divide-y divide-border overflow-hidden">
        {items.map((p) => {
          const s = status(p);
          return (
            <li key={p.id} className="grid gap-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block break-words font-medium">{p.fromClassName} → {p.toClassName}</span>
                  <span className="block text-sm text-ink-soft">Năm học {p.fromSchoolYearName} → {p.toSchoolYearName}</span>
                  <span className="block text-sm text-ink-soft">
                    <span className="tabular-nums">{p.count}</span> em · {WHEN.format(new Date(p.createdAt))}{p.actorName ? ` · ${p.actorName}` : ""}
                  </span>
                  {p.incoming && <span className="block text-xs text-ink-soft">Khối khác chuyển em vào lớp của khối mình; chỉ khối nguồn hoàn tác được.</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}>{s.text}</span>
              </div>
              {p.canUndo && (asking === p.id ? (
                <div className="grid gap-2">
                  <p className="text-sm text-ink-soft">Trả các em còn ở {p.toClassName} về {p.fromClassName}? Chỗ ngồi cũ không được khôi phục.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-secondary" onClick={() => setAsking(null)}>Huỷ</button>
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => confirmUndo(p)}>Xác nhận hoàn tác</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-secondary justify-self-start" onClick={() => setAsking(p.id)}
                  aria-label={`Hoàn tác lên lớp ${p.fromClassName} → ${p.toClassName}`}>
                  <Undo2 aria-hidden size={18} /> Hoàn tác
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
