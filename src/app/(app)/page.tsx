import Link from "next/link";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { attentionByClass } from "@/lib/attendance/attention-counts";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";

export default async function HomePage() {
  const user = await requireUser();
  const classes = await listClassesForUser(db, user);
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const attention = term ? await attentionList(db, user, term.id) : [];
  const needs = attentionByClass(attention);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Lớp của tôi</h1>
      {classes.length === 0 && <p className="text-ink-soft">Bạn chưa được gán lớp nào. Hãy nhờ trưởng khối gán lớp.</p>}
      <ul className="flex flex-col gap-3">
        {classes.map((c) => (
          <li key={c.id}>
            <Link href={`/lop/${c.id}`} className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-card p-4 shadow-sm">
              <span>
                <span className="block text-lg font-semibold">{c.name}</span>
                <span className="text-sm text-ink-soft">{c.studentCount} em{c.canWrite ? "" : " · chỉ xem"}</span>
                {needs.get(c.id) && (
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white ${needs.get(c.id)?.hasWarning ? "bg-warn-alert" : "bg-warn-watch"}`}>
                    {needs.get(c.id)?.count} cần chú ý
                  </span>
                )}
              </span>
              <span aria-hidden className="text-brand">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
