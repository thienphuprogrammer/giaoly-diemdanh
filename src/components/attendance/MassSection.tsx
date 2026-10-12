"use client";
import { CalendarOff, ChevronDown, Church, ScanLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Notice } from "@/components/ui/Notice";
import { STATUS_META } from "@/components/ui/status";
import { dateLabel } from "@/lib/date-label";
import { MASS_CHOICES, massSummary, type MassStatus } from "@/lib/attendance/mass-marks";
import type { Marks } from "@/lib/attendance/marks";
import { scannerHrefFromBoard } from "@/lib/scan-return";
import { cancelMassWeekAction } from "@/server/actions/mass";

export interface MassStudent { id: string; fullName: string; saintName: string | null }

/**
 * Phần "Đi lễ Chúa nhật" trên bảng điểm danh (đi lễ cách 1): gập mặc định, chỉ một dòng tóm tắt "Đi lễ: N/M em".
 * Mở ra: nút "Cả lớp đi lễ" và bốn lựa chọn cho từng em (Chưa hỏi / Có đi / Có phép / Không phép). Không có "đi muộn".
 * Trạng thái hiện bằng chữ + biểu tượng + aria-checked, không chỉ bằng màu.
 */
export function MassSection({ classId, classDate, sunday, students, marks, failedIds, canWrite, cancelled, locked, busy, onPick, onMarkAll }: {
  classId: string;
  /** Ngày học của bảng: lối vào "Tuần này không có lễ" nhận ngày học (máy chủ tự chọn Chúa nhật). */
  classDate: string;
  sunday: string;
  students: readonly MassStudent[];
  marks: Marks;
  failedIds: ReadonlySet<string>;
  canWrite: boolean;
  cancelled: boolean;
  /** Dữ liệu cũ đang chờ bản mới: tạm khoá chạm. */
  locked: boolean;
  /** Một thao tác hàng loạt đang lưu. */
  busy: boolean;
  onPick: (studentId: string, status: MassStatus | null) => void;
  onMarkAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ids = students.map((s) => s.id);
  const summary = massSummary(ids, marks);
  const readOnly = !canWrite || cancelled || locked;
  const router = useRouter();
  const [toggling, startToggle] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);
  // Huỷ/mở lại tuần đi lễ theo id buổi `mass` (không đụng "Buổi nghỉ lễ" của buổi học), rồi đọc lại trang.
  const setWeekCancelled = (value: boolean) => startToggle(async () => {
    setToggleError(null);
    const res = await cancelMassWeekAction({ classId, heldOn: classDate, cancelled: value }).catch(() => null);
    if (res?.ok) router.refresh();
    else setToggleError(res?.error ?? "Chưa lưu được, thử lại.");
  });

  return (
    <section aria-label="Đi lễ Chúa nhật" className="card">
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
        className="flex min-h-14 w-full items-center gap-3 rounded-[inherit] px-4 py-3 text-left">
        <Church aria-hidden size={22} className="shrink-0 text-ink-soft" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-display font-semibold">Đi lễ Chúa nhật</span>
          <span className="text-sm text-ink-soft">
            <span className="tabular-nums">Đi lễ: {summary.went}/{summary.total} em</span>
            {" · "}{dateLabel(sunday)}
          </span>
        </span>
        <ChevronDown aria-hidden size={20} className={`shrink-0 text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-sm text-ink-soft">
            Ghi cho thánh lễ {dateLabel(sunday)} (Chúa nhật trên hoặc trước ngày học). Không tính vào số buổi vắng học.
          </p>
          {cancelled && <Notice tone="info" role="status">Thánh lễ tuần này đã được đánh dấu nghỉ — không ghi đi lễ.</Notice>}
          {canWrite && !cancelled && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button type="button" onClick={onMarkAll} disabled={readOnly || busy || summary.unasked === 0} className="btn btn-primary btn-lg w-full">
                <Church aria-hidden size={20} />
                Cả lớp đi lễ
              </button>
              <Link prefetch={false} href={scannerHrefFromBoard(`/lop/${classId}/di-le/${sunday}`)} className="btn btn-secondary btn-lg w-full">
                <ScanLine aria-hidden size={20} />
                Quét tại nhà thờ
              </Link>
            </div>
          )}
          {canWrite && (
            <button type="button" onClick={() => setWeekCancelled(!cancelled)} disabled={toggling || locked || busy} className="btn btn-ghost btn-sm self-start">
              <CalendarOff aria-hidden size={16} />
              {cancelled ? "Mở lại tuần đi lễ" : "Tuần này không có lễ"}
            </button>
          )}
          {toggleError && <Notice tone="error" role="alert">{toggleError}</Notice>}
          <ul className="flex flex-col divide-y divide-border">
            {students.map((s) => (
              <MassRow key={s.id} student={s} status={(marks[s.id]?.status ?? null) as MassStatus | null}
                failed={failedIds.has(s.id)} disabled={readOnly} onPick={(v) => onPick(s.id, v)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function MassRow({ student, status, failed, disabled, onPick }: {
  student: MassStudent; status: MassStatus | null; failed: boolean; disabled: boolean; onPick: (status: MassStatus | null) => void;
}) {
  return (
    <li className="flex flex-col gap-2 py-3">
      <span className="break-words font-medium leading-snug">
        {student.saintName && <span className="text-sm font-normal text-ink-soft">{student.saintName} </span>}
        {student.fullName}
      </span>
      <span role="radiogroup" aria-label={`Đi lễ của ${student.fullName}`}
        className={`grid grid-cols-4 gap-1.5 rounded-control ${failed ? "ring-[3px] ring-warn-alert ring-offset-2" : ""}`}>
        {MASS_CHOICES.map((c) => {
          const meta = STATUS_META[c.value ?? "none"];
          const Icon = meta.icon;
          const checked = status === c.value;
          // "Chưa hỏi" đang chọn: viền đậm + nền xám (mẫu "none" mặc định trông như nút chưa chọn).
          const solid = c.value === null ? "border-ink bg-surface-muted text-ink" : meta.solid;
          return (
            <button key={c.short} type="button" role="radio" aria-checked={checked} aria-label={c.label} disabled={disabled}
              onClick={() => { if (!checked) onPick(c.value); }}
              className={`btn min-h-11 flex-col gap-0.5 border-2 px-1 py-1 text-xs leading-tight ${checked ? `${solid} font-semibold` : "btn-secondary"}`}>
              <Icon aria-hidden size={16} strokeWidth={2.5} />
              {c.short}
            </button>
          );
        })}
      </span>
    </li>
  );
}
