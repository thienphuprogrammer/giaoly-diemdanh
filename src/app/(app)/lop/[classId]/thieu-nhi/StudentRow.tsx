"use client";
import { useState } from "react";
import { setStudentActiveAction } from "./actions";
import { EditStudentForm, type EditableStudent } from "./EditStudentForm";

export interface RosterStudent extends EditableStudent {
  active: boolean;
}

export function StudentRow({ classId, student, canWrite }: { classId: string; student: RosterStudent; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleActive() {
    setBusy(true);
    setError(null);
    try {
      const result = await setStudentActiveAction(classId, student.id, !student.active);
      if (!result.ok) setError(result.error);
    } catch {
      setError("Không thực hiện được. Kiểm tra kết nối và thử lại.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return <li><EditStudentForm classId={classId} student={student} onDone={() => setEditing(false)} /></li>;
  }
  const btn = "h-11 min-w-11 rounded-lg px-3 text-sm text-ink-soft disabled:opacity-60";
  return (
    <li className={`px-4 py-2 ${student.active ? "" : "opacity-50"}`}>
      <div className="flex min-h-14 items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block font-medium">{student.saintName ? `${student.saintName} ` : ""}{student.fullName}</span>
          <span className="text-sm text-ink-soft">{[student.birthDate, student.parentPhone].filter(Boolean).join(" · ")}{student.active ? "" : " · đã ẩn"}</span>
        </span>
        {canWrite && (
          <span className="flex shrink-0">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={btn}>Sửa</button>
            <button type="button" onClick={toggleActive} disabled={busy} className={btn}>{student.active ? "Ẩn" : "Hiện"}</button>
          </span>
        )}
      </div>
      {error && <p role="alert" className="pb-1 text-sm text-warn-alert">{error}</p>}
    </li>
  );
}
