"use client";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Notice } from "@/components/ui/Notice";
import { parseStudentsCsv, type ImportError } from "@/lib/import/csv";
import type { StudentFields } from "@/lib/students/schema";
import { importStudentsAction } from "./actions";

export function ImportCsv({ classId }: { classId: string }) {
  const [rows, setRows] = useState<StudentFields[]>([]);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    setMessage(undefined);
    if (!file) return;
    try {
      const parsed = parseStudentsCsv(await file.text());
      setRows(parsed.rows);
      setErrors(parsed.errors);
    } catch {
      setRows([]);
      setErrors([]);
      setMessage("Không đọc được file, thử lại.");
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await importStudentsAction(classId, rows);
      if (r.ok) {
        setMessage(`Đã nhập ${r.data.inserted} em${r.data.skipped ? `, bỏ qua ${r.data.skipped} em đã có` : ""}`);
        setRows([]);
        setErrors([]);
        if (fileInput.current) fileInput.current.value = "";
      } else setMessage(r.error);
    } catch {
      setMessage("Không nhập được, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card grid gap-4 p-4">
      <div>
        <h2 className="text-lg font-semibold">Nhập từ file CSV</h2>
        <p className="mt-1 text-sm text-ink-soft">Cột: Tên thánh, Họ tên, Ngày sinh, SĐT phụ huynh, Ghi chú (Excel: Lưu thành CSV).</p>
      </div>
      <label className="grid gap-1.5">
        <span className="label">Chọn file</span>
        <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target)}
          className="block w-full rounded-control border border-dashed border-ink-muted bg-surface-muted p-2 text-base text-ink-soft file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-[8px] file:border file:border-border-strong file:bg-surface file:px-4 file:font-display file:text-base file:font-medium file:text-ink" />
      </label>
      {errors.length > 0 && (
        <ul role="alert" className="grid gap-1 rounded-control border border-warn-alert/30 bg-warn-alert-tint px-3 py-2.5 text-sm font-medium text-warn-alert">
          {errors.map((e) => <li key={`${e.line}-${e.message}`}>{e.line ? `Dòng ${e.line}: ` : ""}{e.message}</li>)}
        </ul>
      )}
      {rows.length > 0 && (
        <button onClick={submit} disabled={busy} className="btn btn-primary btn-lg w-full">
          <Upload aria-hidden size={20} />
          Nhập {rows.length} em{errors.length ? " (bỏ qua dòng lỗi)" : ""}
        </button>
      )}
      {message && <Notice tone="info" role="status">{message}</Notice>}
    </div>
  );
}
