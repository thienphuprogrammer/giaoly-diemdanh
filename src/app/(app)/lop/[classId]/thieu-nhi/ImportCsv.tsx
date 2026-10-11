"use client";
import { useState } from "react";
import { parseStudentsCsv, type ImportError } from "@/lib/import/csv";
import type { StudentFields } from "@/lib/students/schema";
import { importStudentsAction } from "./actions";

export function ImportCsv({ classId }: { classId: string }) {
  const [rows, setRows] = useState<StudentFields[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    setMessage(undefined);
    if (!file) return;
    const parsed = parseStudentsCsv(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
  }

  async function submit() {
    setBusy(true);
    const r = await importStudentsAction(classId, rows);
    setBusy(false);
    if (r.ok) { setMessage(`Đã nhập ${r.data.inserted} em${r.data.skipped ? `, bỏ qua ${r.data.skipped} em đã có` : ""}`); setRows([]); }
    else setMessage(r.error);
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-card p-4">
      <h2 className="font-semibold">Nhập từ file CSV</h2>
      <p className="text-sm text-ink-soft">Cột: Tên thánh, Họ tên, Ngày sinh, SĐT phụ huynh, Ghi chú (Excel: Lưu thành CSV).</p>
      <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
      {errors.length > 0 && (
        <ul role="alert" className="text-sm text-warn-alert">
          {errors.map((e) => <li key={`${e.line}-${e.message}`}>{e.line ? `Dòng ${e.line}: ` : ""}{e.message}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <button onClick={submit} disabled={busy} className="h-12 rounded-xl bg-brand font-semibold text-white disabled:opacity-60">
          Nhập {rows.length} em{errors.length ? " (bỏ qua dòng lỗi)" : ""}
        </button>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
