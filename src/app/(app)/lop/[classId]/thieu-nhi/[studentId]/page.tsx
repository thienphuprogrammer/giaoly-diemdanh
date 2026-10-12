import { ChevronLeft, ClipboardList } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, ReadOnlyPill, StatusPill } from "@/components/ui/Pill";
import { STATUS_META } from "@/components/ui/status";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { dateLabel, shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { getStudentProfile } from "@/server/services/student-profile";
import { ContactButtons } from "./ContactButtons";
import { ContactForm } from "./ContactForm";

const COUNTS = [
  { key: "present", status: "present", label: "Có mặt" },
  { key: "late", status: "late", label: "Đi muộn" },
  { key: "excused", status: "absent_excused", label: "Vắng có phép" },
  { key: "unexcused", status: "absent_unexcused", label: "Vắng không phép" },
] as const;

export default async function StudentProfilePage({ params }: { params: Promise<{ classId: string; studentId: string }> }) {
  const { classId, studentId } = await params;
  const user = await requireUser();
  const profile = await getStudentProfile(db, user, { classId, studentId, today: todayInVietnam() });
  if (!profile) notFound();
  const { student, summary, rate, records, term, canWrite } = profile;
  const percent = rate === null ? null : Math.round(rate * 100);
  return (
    <section className="flex flex-col gap-5">
      <Link href={`/lop/${classId}/thieu-nhi`} className="-ml-2 inline-flex min-h-11 items-center gap-1 self-start rounded-control px-2 text-sm font-medium text-ink-soft hover:text-ink">
        <ChevronLeft aria-hidden size={18} />Danh sách thiếu nhi
      </Link>

      <header className="flex items-center gap-3">
        <Avatar name={student.fullName} muted={!student.active} />
        <div className="min-w-0 flex-1">
          {student.saintName && <p className="text-sm leading-tight text-ink-soft">{student.saintName}</p>}
          <h2 className="break-words text-xl font-semibold leading-snug">{student.fullName}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm tabular-nums text-ink-soft">
            {student.birthDate && <span>Sinh {shortDate(student.birthDate)}</span>}
            {!student.active && <Pill>Đã ẩn</Pill>}
            {!canWrite && <ReadOnlyPill />}
          </p>
        </div>
      </header>

      <div className="card flex flex-col gap-3 p-4">
        <h3 className="text-base font-semibold">Phụ huynh</h3>
        <ContactButtons phone={student.parentPhone} />
        {student.parentPhone && <p className="text-sm tabular-nums text-ink-soft"><span className="sr-only">SĐT phụ huynh </span>{student.parentPhone}</p>}
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <h3 className="text-base font-semibold">Ghi chú</h3>
        {student.note ? <p className="whitespace-pre-wrap break-words">{student.note}</p> : <p className="text-sm text-ink-soft">Chưa có ghi chú.</p>}
        {canWrite && (
          <div className="mt-2">
            <ContactForm key={`${student.parentPhone ?? ""}|${student.note ?? ""}`} classId={classId} studentId={student.id} parentPhone={student.parentPhone} note={student.note} />
          </div>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-base font-semibold">Chuyên cần {term?.name ?? ""}</h3>
          <p className="font-display text-2xl font-semibold tabular-nums" aria-label={percent === null ? "Chưa có buổi điểm danh" : `Tỉ lệ có mặt ${percent} phần trăm`}>
            {percent === null ? "—" : `${percent}%`}
          </p>
        </div>
        <dl className="grid grid-cols-4 gap-2">
          {COUNTS.map((c) => (
            <div key={c.key} className="flex flex-col items-center rounded-control bg-surface-muted py-2">
              <dd className={`order-2 font-display text-lg font-semibold tabular-nums ${c.key === "unexcused" && summary.unexcused > 0 ? "text-st-unexcused" : "text-ink"}`}>{summary[c.key]}</dd>
              <dt className="order-1 text-center text-xs text-ink-soft"><span aria-hidden>{STATUS_META[c.status].short}</span><span className="sr-only">{c.label}</span></dt>
            </div>
          ))}
        </dl>
        {rate !== null && <p className="text-xs text-ink-muted">Tỉ lệ có mặt = (có mặt + đi muộn) / số buổi đã điểm danh ({summary.marked} buổi).</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Các buổi đã điểm danh</h3>
        {records.length === 0 ? (
          <EmptyState icon={ClipboardList} title="Chưa có buổi nào">Khi em được điểm danh trong {term?.name ?? "học kỳ"}, từng buổi sẽ hiện ở đây.</EmptyState>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {records.map((r) => (
              <li key={r.sessionId} className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block font-medium">{dateLabel(r.heldOn)}</span>
                  {r.reason && <span className="block break-words text-sm text-ink-soft">Lý do: {r.reason}</span>}
                </span>
                <StatusPill status={r.status} label={r.status === "absent_unexcused" ? "Vắng không phép" : r.status === "absent_excused" ? "Vắng có phép" : undefined} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
