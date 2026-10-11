import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { classStats, type StatRow } from "@/server/services/stats";

const ROW = "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid sm:grid-cols-[1fr_repeat(4,3rem)_6rem] sm:gap-x-2";
const COLUMNS = [
  { key: "present", short: "CM", full: "Có mặt" },
  { key: "late", short: "M", full: "Đi muộn" },
  { key: "excused", short: "CP", full: "Vắng có phép" },
  { key: "unexcused", short: "KP", full: "Vắng không phép" },
] as const;

const badgeClass = (level: string) =>
  level === "warning" ? "bg-warn-alert text-white" : level === "watch" ? "bg-warn-watch text-white" : "";
const badgeText = (level: string) => (level === "warning" ? "Cảnh báo" : level === "watch" ? "Vắng 1" : "");

function StatLine({ row }: { row: StatRow }) {
  const level = row.summary.warning.level;
  return (
    <div role="row" className={`${ROW} text-sm`}>
      <div role="cell" className="basis-full break-words font-medium sm:basis-auto">{row.fullName}</div>
      {COLUMNS.map((c) => (
        <div role="cell" key={c.key} className="sm:text-center">
          <span aria-hidden className="text-ink-soft sm:hidden">{c.short} </span>
          {row.summary[c.key]}
        </div>
      ))}
      <div role="cell" className="sm:text-center">
        {level !== "none" && (
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(level)}`}>{badgeText(level)}</span>
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
  if (!term) return <p className="text-ink-soft">Chưa có học kỳ nào.</p>;
  const stats = await classStats(db, user, classId, term.id);
  if (!stats) notFound();
  const terms = await listTerms(db);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-2" aria-label="Học kỳ">
          {terms.map((t) => (
            <Link key={t.id} href={`?termId=${t.id}`}
              className={`flex h-11 items-center rounded-full border px-4 text-sm ${t.id === term.id ? "border-brand bg-brand text-white" : "border-line bg-card"}`}>
              {t.name}
            </Link>
          ))}
        </nav>
        <a href={`/lop/${classId}/thong-ke/export?termId=${term.id}`} className="flex h-11 items-center rounded-lg border border-line bg-card px-4 text-sm font-medium">Xuất Excel</a>
      </div>
      <div role="table" aria-label={`Thống kê ${stats.className} ${stats.term.name}`} className="overflow-hidden rounded-2xl border border-line bg-card">
        <div role="rowgroup" className="sr-only sm:not-sr-only">
          <div role="row" className={`${ROW} border-b border-line text-xs font-semibold text-ink-soft`}>
            <div role="columnheader">Em</div>
            {COLUMNS.map((c) => (
              <div role="columnheader" key={c.key} className="sm:text-center">
                <abbr title={c.full} aria-hidden className="no-underline">{c.short}</abbr>
                <span className="sr-only">{c.full}</span>
              </div>
            ))}
            <div role="columnheader"><span className="sr-only">Cảnh báo</span></div>
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-line">
          {stats.rows.map((r) => <StatLine key={r.studentId} row={r} />)}
        </div>
      </div>
    </section>
  );
}
