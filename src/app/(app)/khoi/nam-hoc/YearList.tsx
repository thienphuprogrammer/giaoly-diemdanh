"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { shortDate } from "@/lib/date-label";
import type { ActionResult } from "@/server/result";
import type { SchoolYearSummary } from "@/server/services/school-years";

interface Props {
  years: SchoolYearSummary[];
  today: string;
  remove: (input: { schoolYearId: string }) => Promise<ActionResult<undefined>>;
}

/** Các năm học kèm học kỳ; năm chưa có buổi nào xoá được (tạo nhầm), hỏi lại một lần. */
export function YearList({ years, today, remove }: Props) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function confirm(y: SchoolYearSummary) {
    setBusy(true);
    try {
      const r = await remove({ schoolYearId: y.id });
      setMessage(r.ok ? { tone: "success", text: `Đã xoá năm học ${y.name}` } : { tone: "error", text: r.error });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Không lưu được. Kiểm tra mạng rồi thử lại." });
    } finally {
      setBusy(false);
      setAsking(null);
    }
  }

  if (years.length === 0) return null;
  return (
    <div className="grid gap-3">
      {message && <Notice tone={message.tone} role={message.tone === "error" ? "alert" : "status"}>{message.text}</Notice>}
      <ul aria-label="Các năm học" className="card divide-y divide-border overflow-hidden">
        {years.map((y) => (
          <li key={y.id} className="grid gap-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-medium">{y.name}</span>
                {y.terms.map((t) => (
                  <span key={t.id} className="block text-sm tabular-nums text-ink-soft">
                    {t.name}: {shortDate(t.startsOn)} – {shortDate(t.endsOn)}{t.startsOn <= today && today <= t.endsOn ? " · đang học" : ""}
                  </span>
                ))}
              </span>
              {y.deletable && asking !== y.id && (
                <button type="button" className="btn btn-ghost btn-icon shrink-0" aria-label={`Xoá năm học ${y.name}`} onClick={() => setAsking(y.id)}>
                  <Trash2 aria-hidden size={18} />
                </button>
              )}
            </div>
            {asking === y.id && (
              <div className="grid gap-2">
                <p className="text-sm text-ink-soft">Xoá năm học {y.name} và các học kỳ của nó? Năm học chưa có buổi điểm danh nào nên không mất dữ liệu.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn btn-secondary" onClick={() => setAsking(null)}>Huỷ</button>
                  <button type="button" className="btn btn-danger" disabled={busy} onClick={() => confirm(y)}>Xoá năm học</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
