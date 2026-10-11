"use client";
import { Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { activatePlanAction, deletePlanAction } from "./actions";

const GENERIC_ERROR = "Không thực hiện được, thử lại sau.";

export function PlanActions({ classId, planId }: { classId: string; planId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, after: () => void) {
    setBusy(true);
    setMessage(undefined);
    try {
      const r = await action();
      if (r.ok) after();
      else setMessage(r.error ?? GENERIC_ERROR);
    } catch {
      setMessage(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const activate = () => run(() => activatePlanAction(classId, planId), () => router.refresh());
  const remove = () => {
    if (!window.confirm("Xóa sơ đồ này?")) return;
    return run(() => deletePlanAction(classId, planId), () => {
      router.replace(`/lop/${classId}/so-do`);
      router.refresh();
    });
  };

  return (
    <div className="card flex flex-col gap-3 p-4">
      <p className="text-sm text-ink-soft">Sơ đồ này chưa được dùng khi điểm danh.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button className="btn btn-secondary" disabled={busy} onClick={activate}>
          <Star aria-hidden size={20} />Dùng sơ đồ này
        </button>
        <button className="btn btn-danger" disabled={busy} onClick={remove}>
          <Trash2 aria-hidden size={20} />Xóa sơ đồ
        </button>
      </div>
      {message && <Notice tone="error" role="status">{message}</Notice>}
    </div>
  );
}
