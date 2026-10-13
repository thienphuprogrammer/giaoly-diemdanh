import { ChartColumn, ChevronRight, ClipboardCheck, GraduationCap, QrCode, UsersRound } from "lucide-react";
import Link from "next/link";
import { SchoolYearFilter } from "@/components/nav/SchoolYearFilter";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReadOnlyPill, WarningPill } from "@/components/ui/Pill";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { attentionByClass } from "@/lib/attendance/attention-counts";
import { classQuickActions, type ClassQuickAction } from "@/lib/class-quick-actions";
import { dateLabel } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";
import { listSchoolYearsForUser, resolveSchoolYearForUser } from "@/server/services/school-years";

const ACTION_ICONS: Record<ClassQuickAction["key"], typeof QrCode> = { board: ClipboardCheck, scan: QrCode, stats: ChartColumn };

export default async function ClassesPage({ searchParams }: { searchParams: Promise<{ schoolYearId?: string }> }) {
  const { schoolYearId } = await searchParams;
  const user = await requireUser();
  const today = todayInVietnam();
  const [years, schoolYear] = await Promise.all([
    listSchoolYearsForUser(db, user),
    resolveSchoolYearForUser(db, user, schoolYearId, today),
  ]);
  const classes = schoolYear ? await listClassesForUser(db, user, schoolYear.id) : [];
  const term = schoolYear ? await resolveTerm(db, undefined, today, schoolYear.id) : null;
  const isCurrentYear = schoolYear?.terms.some((t) => t.startsOn <= today && today <= t.endsOn) ?? false;
  const attention = term ? await attentionList(db, user, term.id) : [];
  const needs = attentionByClass(attention);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
        <p className="font-display text-sm font-medium text-ink-soft">{dateLabel(today)}</p>
        <h1 className="mt-1 text-2xl font-semibold">{user.isAdmin ? "Tất cả lớp" : "Lớp của tôi"}</h1>
        <p className="mt-1 text-ink-soft">Xin chào, {user.name}{schoolYear ? ` · ${schoolYear.name}` : ""}{term ? ` · ${term.name}` : ""}</p>
        </div>
        {classes.length > 0 && (
          <dl className="hidden items-center gap-6 border-l border-border pl-6 lg:flex">
            <div><dt className="text-sm text-ink-soft">Lớp</dt><dd className="font-display text-xl font-semibold tabular-nums">{classes.length}</dd></div>
            <div><dt className="text-sm text-ink-soft">Thiếu nhi</dt><dd className="font-display text-xl font-semibold tabular-nums">{classes.reduce((sum, c) => sum + c.studentCount, 0)}</dd></div>
          </dl>
        )}
      </div>
      <SchoolYearFilter years={years} selectedSchoolYearId={schoolYear?.id ?? null} action="/lop" />
      {classes.length === 0 && (
        <EmptyState icon={GraduationCap} title={user.isAdmin ? "Năm học chưa có lớp" : "Bạn chưa được gán lớp nào trong năm học này"}>
          {user.isAdmin ? <Link href="/quan-tri" className="text-action underline">Mở quản trị để tạo lớp và chọn năm học.</Link> : "Hãy nhờ trưởng khối gán lớp cho bạn, hoặc chọn năm học khác."}
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:flex xl:flex-col xl:gap-0 xl:overflow-hidden xl:rounded-card xl:border xl:border-border xl:bg-surface">
        {classes.map((c) => {
          const need = needs.get(c.id);
          const nameId = `lop-${c.id}-ten`;
          return (
            <li key={c.id} className="card flex h-full flex-col overflow-hidden xl:flex-row xl:items-center xl:rounded-none xl:border-0 xl:border-b xl:last:border-b-0">
              <Link href={`/lop/${c.id}`}
                className="group flex min-h-20 flex-1 items-center gap-4 p-4 outline-offset-[-3px] transition-colors hover:bg-action-tint/40 xl:min-w-0 xl:basis-1/2">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-control bg-surface-muted text-ink-soft">
                  <GraduationCap size={24} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span id={nameId} className="break-words font-display text-lg font-semibold leading-tight text-ink">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                    <span className="inline-flex items-center gap-1.5">
                      <UsersRound aria-hidden size={16} />
                      <span className="tabular-nums">{c.studentCount} em</span>
                    </span>
                    {!c.canWrite && <ReadOnlyPill />}
                    {need && <WarningPill level={need.hasWarning ? "warning" : "watch"}>{need.count} cần chú ý</WarningPill>}
                  </span>
                </span>
                <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted group-hover:text-action" />
              </Link>
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 xl:w-[45%] xl:border-t-0">
                {(isCurrentYear ? classQuickActions({ classId: c.id, canWrite: c.canWrite, today }) : [
                  { key: "stats", label: "Thống kê năm học", href: `/lop/${c.id}/thong-ke`, primary: false } satisfies ClassQuickAction,
                ]).map((a) => {
                  const Icon = ACTION_ICONS[a.key];
                  return (
                    // prefetch={false}: mở bảng/máy quét của người có quyền ghi tạo buổi, không được chạy khi chỉ prefetch.
                    <Link key={a.key} prefetch={false} href={a.href} aria-describedby={nameId}
                      className={`btn ${a.primary ? "btn-primary" : "btn-secondary"} min-h-11 min-w-[9.5rem] flex-1 text-[0.95rem] leading-tight`}>
                      <Icon aria-hidden size={18} className="shrink-0" />
                      {a.label}
                    </Link>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
