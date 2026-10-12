import { CalendarRange, Download, Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { WarningPill } from "@/components/ui/Pill";
import { STATUS_META } from "@/components/ui/status";
import { db } from "@/db/client";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { membershipNote } from "@/lib/promotion";
import { classStats, type StatRow } from "@/server/services/stats";

const ROW = "grid grid-cols-4 items-center gap-x-2 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(4,4.5rem)_8rem]";
const COLUMNS = [
  { key: "present", status: "present", full: "Có mặt" },
  { key: "late", status: "late", full: "Đi muộn" },
  { key: "excused", status: "absent_excused", full: "Vắng có phép" },
  { key: "unexcused", status: "absent_unexcused", full: "Vắng không phép" },
] as const;

function StatLine({ row }: { row: StatRow }) {
  const level = row.summary.warning.level;
  return (
    <div role="row" className={ROW}>
      <div role="cell" className="order-first col-span-3 break-words font-medium sm:order-none sm:col-span-1">
        {row.fullName}
        {membershipNote(row) && <span className="ml-1.5 text-xs font-normal text-ink-soft">{membershipNote(row)}</span>}
      </div>
      {COLUMNS.map((c) => (
        <div role="cell" key={c.key} className="flex flex-col items-center rounded-control bg-surface-muted py-1.5 sm:bg-transparent sm:py-0">
          <span aria-hidden className="text-xs text-ink-soft sm:hidden">{STATUS_META[c.status].short}</span>
          <span className={`font-display text-base font-semibold tabular-nums ${c.key === "unexcused" && row.summary.unexcused > 0 ? "text-st-unexcused" : "text-ink"}`}>
            {row.summary[c.key]}
          </span>
        </div>
      ))}
      <div role="cell" className="-order-1 flex justify-end sm:order-none sm:justify-center">
        {level !== "none" && (
          <WarningPill level={level === "warning" ? "warning" : "watch"}>{level === "warning" ? "Cảnh báo" : "Vắng 1"}</WarningPill>
        )}
      </div>
    </div>
  );
}

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ termId?: string }>;
}) {
  const { classId } = await params;
  const { termId } = await searchParams;
  const user = await requireUser();
  const term = await resolveTerm(db, termId, todayInVietnam());
  if (!term) return <EmptyState icon={CalendarRange} title="Chưa có học kỳ nào">Khi có học kỳ, số liệu chuyên cần của lớp sẽ hiện ở đây.</EmptyState>;
  const stats = await classStats(db, user, classId, term.id);
  if (!stats) notFound();
  const terms = await listTerms(db);
  const warnings = stats.rows.filter((r) => r.summary.warning.level === "warning").length;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Thống kê {stats.term.name}</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            <span className="tabular-nums">{stats.rows.length}</span> em{warnings > 0 ? <> · <span className="font-medium text-warn-alert">{warnings} cảnh báo</span></> : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/lop/${classId}/thong-ke/bao-cao?termId=${term.id}`} className="btn btn-secondary" prefetch={false}>
            <Printer aria-hidden size={20} />Báo cáo in được
          </Link>
          <a href={`/lop/${classId}/thong-ke/export?termId=${term.id}`} className="btn btn-secondary">
            <Download aria-hidden size={20} />Xuất Excel
          </a>
        </div>
      </div>
      {terms.length > 1 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Học kỳ">
          {terms.map((t) => (
            <Link key={t.id} href={`?termId=${t.id}`} aria-current={t.id === term.id ? "page" : undefined}
              className={`flex h-11 shrink-0 items-center rounded-full border px-4 font-display text-sm font-medium transition-colors ${t.id === term.id ? "border-action bg-action text-on-action" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}>
              {t.name}
            </Link>
          ))}
        </nav>
      )}
      <div role="table" aria-label={`Thống kê ${stats.className} ${stats.term.name}`} className="card overflow-hidden">
        <div role="rowgroup" className="sr-only sm:not-sr-only">
          <div role="row" className={`${ROW} border-b border-border bg-surface-muted font-display text-xs font-medium text-ink-soft`}>
            <div role="columnheader">Em</div>
            {COLUMNS.map((c) => (
              <div role="columnheader" key={c.key} className="text-center">
                <span aria-hidden>{STATUS_META[c.status].short}</span>
                <span className="sr-only">{c.full}</span>
              </div>
            ))}
            <div role="columnheader"><span className="sr-only">Cảnh báo</span></div>
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-border">
          {stats.rows.map((r) => <StatLine key={r.studentId} row={r} />)}
        </div>
      </div>
    </section>
  );
}
