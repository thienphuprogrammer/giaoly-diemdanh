"use client";
import { LayoutTemplate } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TemplateCard } from "@/components/seating/TemplateCard";
import { Notice } from "@/components/ui/Notice";
import { TEMPLATES } from "@/lib/seating/templates";
import { applyTemplateAction } from "./actions";

const GENERIC_ERROR = "Không áp dụng được mẫu, thử lại sau.";

/** Chỉ hiển thị cho sơ đồ chưa có em nào ngồi; server cũng từ chối nếu đã có phân ghế. */
export function ApplyTemplate({ classId, planId, studentCount }: { classId: string; planId: string; studentCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function apply(templateId: string) {
    if (!window.confirm("Thay bố cục hiện tại bằng mẫu này?")) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await applyTemplateAction(classId, { planId, templateId });
      if (r.ok) {
        // Tham số v ép trình chỉnh dựng lại với bố cục mới.
        router.replace(`/lop/${classId}/so-do?plan=${planId}&v=${crypto.randomUUID()}`);
        router.refresh();
      } else setMessage(r.error);
    } catch {
      setMessage(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-display text-base font-semibold">
        <LayoutTemplate aria-hidden size={20} />Dùng mẫu bố cục
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="text-sm text-ink-soft">Chỉ dùng được khi chưa xếp em nào vào sơ đồ này. Bố cục hiện tại sẽ được thay.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.id} template={t} studentCount={studentCount} disabled={busy} onClick={() => apply(t.id)} />
          ))}
        </div>
        {message && <Notice tone="error" role="alert">{message}</Notice>}
      </div>
    </details>
  );
}
