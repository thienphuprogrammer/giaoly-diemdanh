import { ChevronRight, GraduationCap, UsersRound } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReadOnlyPill, WarningPill } from "@/components/ui/Pill";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { attentionByClass } from "@/lib/attendance/attention-counts";
import { dateLabel } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";

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
          return (
            <li key={c.id}>
              <Link href={`/lop/${c.id}`}
                className="card group flex h-full min-h-24 items-center gap-4 p-4 transition-colors hover:border-action/50 hover:bg-action-tint/40">
                <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center self-start rounded-control bg-action-tint text-action">
                  <GraduationCap size={24} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="font-display text-xl font-semibold leading-tight text-ink">{c.name}</span>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
