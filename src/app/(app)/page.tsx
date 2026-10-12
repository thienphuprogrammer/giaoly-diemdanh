import { ChartColumn, ChevronRight, ClipboardCheck, GraduationCap, QrCode, UsersRound } from "lucide-react";
import Link from "next/link";
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

const ACTION_ICONS: Record<ClassQuickAction["key"], typeof QrCode> = { board: ClipboardCheck, scan: QrCode, stats: ChartColumn };

export default async function HomePage() {
  const user = await requireUser();
  const classes = await listClassesForUser(db, user);
  const today = todayInVietnam();
  const term = await resolveTerm(db, undefined, today);
  const attention = term ? await attentionList(db, user, term.id) : [];
  const needs = attentionByClass(attention);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <p className="font-display text-sm font-medium text-ink-soft">{dateLabel(today)}</p>
        <h1 className="mt-1 text-2xl font-semibold">Lớp của tôi</h1>
        <p className="mt-1 text-ink-soft">Xin chào, {user.name}{term ? ` · ${term.name}` : ""}</p>
      </div>
      {classes.length === 0 && (
        <EmptyState icon={GraduationCap} title="Bạn chưa được gán lớp nào">
          Hãy nhờ trưởng khối gán lớp cho bạn, rồi mở lại trang này.
        </EmptyState>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {classes.map((c) => {
          const need = needs.get(c.id);
          const nameId = `lop-${c.id}-ten`;
          return (
            <li key={c.id} className="card flex h-full flex-col overflow-hidden">
              <Link href={`/lop/${c.id}`}
                className="group flex min-h-20 flex-1 items-center gap-4 p-4 outline-offset-[-3px] transition-colors hover:bg-action-tint/40">
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-control bg-action-tint text-action">
                  <GraduationCap size={24} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span id={nameId} className="font-display text-xl font-semibold leading-tight text-ink">{c.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                    <span className="inline-flex items-center gap-1.5">
                      <UsersRound aria-hidden size={16} />
                      <span className="tabular-nums">{c.studentCount} em</span>
                    </span>
                    {!c.canWrite && <ReadOnlyPill />}
                    {need && <WarningPill level={need.hasWarning ? "warning" : "watch"}>{need.count} cần chú ý</WarningPill>}
                  </span>
                </span>
                <ChevronRight aria-hidden size={24} className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5 group-hover:text-action" />
              </Link>
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                {classQuickActions({ classId: c.id, canWrite: c.canWrite, today }).map((a) => {
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
