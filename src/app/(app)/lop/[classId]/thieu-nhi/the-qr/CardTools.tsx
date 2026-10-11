"use client";
import { Printer, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rotateQrTokenAction } from "./actions";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-primary btn-lg print:hidden">
      <Printer aria-hidden size={20} /> In thẻ
    </button>
  );
}

export function RotateButton({ classId, studentId, fullName }: { classId: string; studentId: string; fullName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function rotate() {
    if (!window.confirm(`Cấp lại mã cho ${fullName}? Thẻ cũ của em sẽ không dùng được nữa.`)) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rotateQrTokenAction(classId, studentId);
      if (!result.ok) setError(result.error); else router.refresh();
    } catch {
      setError("Không cấp lại được, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="print:hidden">
      <button type="button" onClick={rotate} disabled={busy} aria-label={`Cấp lại mã cho ${fullName}`} className="btn btn-secondary btn-sm">
        <RefreshCw aria-hidden size={16} /> Cấp lại mã
      </button>
      {error && <p role="alert" className="mt-1 text-sm text-warn-alert">{error}</p>}
    </div>
  );
}
