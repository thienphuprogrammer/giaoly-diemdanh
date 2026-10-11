"use client";
import { Cake, Eye, EyeOff, Pencil, Phone } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { shortDate } from "@/lib/date-label";
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
  const btn = "flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-control px-1.5 font-display text-xs font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-50";
  const meta = student.birthDate || student.parentPhone;
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar name={student.fullName} muted={!student.active} />
        <span className="min-w-0 flex-1">
          {student.saintName && <span className="block text-sm leading-tight text-ink-soft">{student.saintName}</span>}
          <span className={`block break-words font-medium leading-snug ${student.active ? "text-ink" : "text-ink-soft"}`}>{student.fullName}</span>
          {(meta || !student.active) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums text-ink-soft">
              {student.birthDate && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap"><Cake aria-hidden size={14} /><span className="sr-only">Ngày sinh </span>{shortDate(student.birthDate)}</span>
              )}
              {student.parentPhone && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap"><Phone aria-hidden size={14} /><span className="sr-only">SĐT phụ huynh </span>{student.parentPhone}</span>
              )}
              {!student.active && <Pill icon={EyeOff}>Đã ẩn</Pill>}
            </span>
          )}
        </span>
        {canWrite && (
          <span className="-mr-1.5 flex shrink-0">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={btn}>
              <Pencil aria-hidden size={20} />Sửa
            </button>
            <button type="button" onClick={toggleActive} disabled={busy} className={btn}>
              {student.active ? <EyeOff aria-hidden size={20} /> : <Eye aria-hidden size={20} />}
              {student.active ? "Ẩn" : "Hiện"}
            </button>
          </span>
        )}
      </div>
      {error && <Notice tone="error" role="alert" className="mt-2">{error}</Notice>}
    </li>
  );
}
