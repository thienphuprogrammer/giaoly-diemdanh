import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { classStats } from "@/server/services/stats";

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
  const badge = (level: string) =>
    level === "warning" ? "bg-warn-alert text-white" : level === "watch" ? "bg-warn-watch text-white" : "";
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
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div className="grid grid-cols-[1fr_repeat(4,2.25rem)_5.5rem] items-center gap-x-1 border-b border-line px-3 py-2 text-xs font-semibold text-ink-soft">
          <span>Em</span><span title="Có mặt">CM</span><span title="Đi muộn">M</span><span title="Vắng có phép">CP</span><span title="Vắng không phép">KP</span><span />
        </div>
        <ul className="divide-y divide-line">
          {stats.rows.map((r) => (
            <li key={r.studentId} className="grid min-h-12 grid-cols-[1fr_repeat(4,2.25rem)_5.5rem] items-center gap-x-1 px-3 py-2 text-sm">
              <span className="truncate font-medium">{r.fullName}</span>
              <span>{r.summary.present}</span><span>{r.summary.late}</span><span>{r.summary.excused}</span><span>{r.summary.unexcused}</span>
              <span className={`rounded-full px-2 py-0.5 text-center text-xs font-semibold ${badge(r.summary.warning.level)}`}>
                {r.summary.warning.level === "warning" ? "Cảnh báo" : r.summary.warning.level === "watch" ? "Vắng 1" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
