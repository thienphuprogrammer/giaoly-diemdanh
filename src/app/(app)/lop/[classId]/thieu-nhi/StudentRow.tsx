"use client";
import { ArrowUpRight, Cake, Eye, EyeOff, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { shortDate } from "@/lib/date-label";
import { setStudentActiveAction } from "./actions";
import { EditStudentForm, type EditableStudent } from "./EditStudentForm";

export interface RosterStudent extends EditableStudent {
  active: boolean;
  former?: boolean;
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

  if (editing && canWrite) {
    return <li><EditStudentForm classId={classId} student={student} onDone={() => setEditing(false)} /></li>;
  }
  const btn = "flex h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-control px-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-50 lg:flex-row lg:gap-1 lg:text-sm";
  const meta = student.birthDate || student.parentPhone;
  const columns = canWrite
    ? "lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem]"
    : "lg:grid-cols-[minmax(0,1fr)_7rem_9rem]";
  return (
    <li className="px-4 py-3 transition-colors hover:bg-surface-muted/60 lg:py-2">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 ${columns}`}>
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
          <span className="lg:hidden"><Avatar name={student.fullName} muted={!student.active} /></span>
          <span className="min-w-0 flex-1">
            <Link href={`/lop/${classId}/thieu-nhi/${student.id}`} className="-my-1 block min-h-11 rounded-control py-1 hover:underline">
              {student.saintName && <span className="block text-xs leading-tight text-ink-soft">{student.saintName}</span>}
              <span className={`block break-words font-medium leading-snug ${student.active ? "text-ink" : "text-ink-soft"}`}>{student.fullName}</span>
            </Link>
            {!student.active && <Pill icon={EyeOff}>Đã ẩn</Pill>}
            {student.former && <Pill icon={ArrowUpRight}>Đã chuyển lớp</Pill>}
          </span>
        </span>
        <span className={`col-start-1 flex-wrap items-center gap-x-3 gap-y-1 pl-13 text-sm tabular-nums text-ink-soft lg:contents ${meta ? "flex" : "hidden"}`}>
          <span className="inline-flex items-center gap-1 lg:col-start-2 lg:row-start-1">
            {student.birthDate ? <><Cake aria-hidden size={14} className="lg:hidden" /><span className="sr-only">Ngày sinh </span>{shortDate(student.birthDate)}</> : <span className="hidden lg:inline">—</span>}
          </span>
          <span className="inline-flex items-center gap-1 lg:col-start-3 lg:row-start-1">
            {student.parentPhone ? <><Phone aria-hidden size={14} className="lg:hidden" /><span className="sr-only">SĐT phụ huynh </span><span className="break-all">{student.parentPhone}</span></> : <span className="hidden lg:inline">—</span>}
          </span>
        </span>
        {canWrite && (
          <span className="col-start-2 row-start-1 row-span-2 -mr-1.5 flex shrink-0 justify-end lg:col-start-4 lg:row-span-1">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className={btn}>
              <Pencil aria-hidden size={18} />Sửa
            </button>
            <button type="button" onClick={toggleActive} disabled={busy} className={btn}>
              {student.active ? <EyeOff aria-hidden size={18} /> : <Eye aria-hidden size={18} />}
              {student.active ? "Ẩn" : "Hiện"}
            </button>
          </span>
        )}
      </div>
      {error && <Notice tone="error" role="alert" className="mt-2">{error}</Notice>}
    </li>
  );
}
