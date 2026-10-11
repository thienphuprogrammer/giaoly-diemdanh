"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { activatePlanAction, deletePlanAction } from "./actions";

const GENERIC_ERROR = "Không thực hiện được, thử lại sau.";
const btn = "h-11 rounded-lg border border-line bg-card px-4 text-sm disabled:opacity-60";

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
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button className={btn} disabled={busy} onClick={activate}>Dùng sơ đồ này</button>
        <button className={`${btn} text-warn-alert`} disabled={busy} onClick={remove}>Xóa sơ đồ</button>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
