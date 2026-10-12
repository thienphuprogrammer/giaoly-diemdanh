import { ChevronRight, CircleCheck, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { WarningPill } from "@/components/ui/Pill";
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { DEFAULT_RULES } from "@/lib/attendance/warning";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { phoneLinks } from "@/lib/phone";
import { attentionList } from "@/server/services/stats";

export default async function AttentionPage() {
  const user = await requireUser();
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const items = term ? await attentionList(db, user, term.id) : [];
  const groups = Map.groupBy(items, (i) => i.classId);
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cần chú ý</h1>
        <p className="mt-1 text-ink-soft">{term?.name ?? "Chưa có học kỳ"} · vắng không phép từ {DEFAULT_RULES.unexcusedThreshold} buổi là cảnh báo.</p>
      </div>
      {items.length === 0 && (
        <EmptyState icon={CircleCheck} title="Chưa em nào cần chú ý">
          Khi một em vắng không phép, tên em sẽ hiện ở đây để bạn kịp hỏi thăm gia đình.
        </EmptyState>
      )}
      {[...groups.values()].map((list) => (
        <div key={list[0].classId} className="card overflow-hidden">
          <Link href={`/lop/${list[0].classId}/thong-ke`}
            className="flex min-h-14 items-center gap-2 border-b border-border bg-surface-muted px-4 py-3 outline-offset-[-3px] transition-colors hover:bg-action-tint">
            <span className="min-w-0 flex-1">
              <span className="block font-display text-lg font-semibold">{list[0].className}</span>
              <span className="text-sm text-ink-soft"><span className="tabular-nums">{list.length}</span> em · xem thống kê</span>
            </span>
            <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted" />
          </Link>
          <ul className="divide-y divide-border">
            {list.map((i) => {
              const links = phoneLinks(i.parentPhone);
              return (
                <li key={i.studentId} className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                  <Avatar name={i.fullName} />
                  <span className="flex min-w-[9rem] flex-1 flex-col items-start gap-1">
                    <Link href={`/lop/${i.classId}/thieu-nhi/${i.studentId}`} className="-my-1 inline-flex min-h-11 items-center break-words py-1 font-medium hover:underline">{i.fullName}</Link>
                    <WarningPill level={i.level === "warning" ? "warning" : "watch"}>
                      {i.level === "warning" ? `Cảnh báo · ${i.unexcused} buổi` : "Vắng 1 buổi"}
                    </WarningPill>
                  </span>
                  {links ? (
                    <a href={links.tel} className="btn btn-secondary btn-sm shrink-0">
                      <Phone aria-hidden size={18} />Gọi phụ huynh<span className="sr-only"> {i.fullName}</span>
                    </a>
                  ) : (
                    <span className="shrink-0 text-sm text-ink-soft">Chưa có số phụ huynh</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
