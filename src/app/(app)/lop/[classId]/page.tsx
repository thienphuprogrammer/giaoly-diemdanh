import { CalendarDays, ChevronRight, Church, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, StatusPill } from "@/components/ui/Pill";
import { db } from "@/db/client";
import { listSessions } from "@/db/queries/attendance";
import { massSundayFor } from "@/lib/attendance/mass-week";
import { requireUser } from "@/lib/auth/dal";
import { dateLabel } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { classPermissions } from "@/server/guard";
import { getClassSchedule } from "@/server/services/class-schedule";
import { setClassScheduleAction } from "./actions";
import { OpenDate } from "./OpenDate";
import { ScheduleForm } from "./ScheduleForm";

export default async function ClassHomePage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const today = todayInVietnam();
  const sunday = massSundayFor(today); // hôm nay nếu là Chúa nhật, không thì Chúa nhật vừa qua
  const [sessions, schedule] = await Promise.all([listSessions(db, classId), getClassSchedule(db, user, classId)]);
  return (
    <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {perms.canWrite && (
          <div className="card flex flex-col gap-4 p-4">
            {/* prefetch={false}: mở buổi tạo bản ghi, không được chạy khi chỉ prefetch */}
            <Link prefetch={false} href={`/lop/${classId}/diem-danh/${today}`}
              className="btn btn-primary min-h-14 w-full text-lg lg:min-h-11 lg:text-base">
              <ClipboardCheck aria-hidden size={22} />
              Điểm danh hôm nay
            </Link>
            <p className="-mt-2 text-center text-sm text-ink-soft">{dateLabel(today)}</p>
            {/* Đi lễ "cách 2": quét thẻ tại nhà thờ cho thánh lễ Chúa nhật (mở buổi đi lễ khi vào màn quét). */}
            <Link prefetch={false} href={`/lop/${classId}/di-le/${sunday}/quet`} className="btn btn-secondary btn-lg w-full lg:min-h-11">
              <Church aria-hidden size={20} />
              Điểm danh đi lễ
            </Link>
            <p className="-mt-2 text-center text-sm text-ink-soft">Quét thẻ tại nhà thờ · {dateLabel(sunday)}</p>
            <div className="border-t border-border pt-4">
              <OpenDate classId={classId} today={today} />
            </div>
          </div>
        )}
        {schedule && (
          <ScheduleForm classId={classId} meetsOn={schedule.meetsOn} meetsAt={schedule.meetsAt} label={schedule.label}
            canEdit={schedule.canEdit} action={setClassScheduleAction} />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="text-lg font-semibold">Các buổi gần đây</h2>
        {sessions.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Chưa có buổi nào">
            {perms.canWrite ? "Bấm \"Điểm danh hôm nay\" để bắt đầu." : "Khi giáo lý viên điểm danh, các buổi sẽ hiện ở đây."}
          </EmptyState>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link prefetch={false} href={`/lop/${classId}/diem-danh/${s.heldOn}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 outline-offset-[-3px] transition-colors hover:bg-surface-muted lg:min-h-14 lg:py-2">
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5 2xl:flex-row 2xl:items-center 2xl:justify-between">
                    <span className="font-display font-medium text-ink">{dateLabel(s.heldOn)}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {s.cancelled ? <Pill>Nghỉ lễ</Pill> : (
                        <>
                          <span className="text-sm text-ink-soft"><span className="tabular-nums">{s.marked}</span> đã điểm danh</span>
                          {s.absent > 0 && <StatusPill status="absent_unexcused" label={`${s.absent} vắng KP`} />}
                        </>
                      )}
                    </span>
                  </span>
                  <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
