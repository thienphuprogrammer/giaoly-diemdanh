import Link from "next/link";
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { DEFAULT_RULES } from "@/lib/attendance/warning";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { attentionList } from "@/server/services/stats";

export default async function AttentionPage() {
  const user = await requireUser();
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const items = term ? await attentionList(db, user, term.id) : [];
  const groups = Map.groupBy(items, (i) => i.classId);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Cần chú ý</h1>
      <p className="text-sm text-ink-soft">{term?.name ?? "Chưa có học kỳ"} · vắng không phép từ {DEFAULT_RULES.unexcusedThreshold} buổi là cảnh báo.</p>
      {items.length === 0 && <p className="rounded-2xl border border-line bg-card p-4">Chưa có em nào cần chú ý. 🎉</p>}
      {[...groups.values()].map((list) => (
        <div key={list[0].classId} className="rounded-2xl border border-line bg-card">
          <Link href={`/lop/${list[0].classId}/thong-ke`} className="block border-b border-line px-4 py-3 font-semibold">{list[0].className}</Link>
          <ul className="divide-y divide-line">
            {list.map((i) => (
              <li key={i.studentId} className="flex min-h-12 items-center justify-between px-4 py-2">
                <span className="font-medium">{i.fullName}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold text-white ${i.level === "warning" ? "bg-warn-alert" : "bg-warn-watch"}`}>
                  {i.level === "warning" ? `Cảnh báo · ${i.unexcused} buổi` : "Vắng 1 buổi"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
