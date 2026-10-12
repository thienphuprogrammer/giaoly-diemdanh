import { ChevronRight, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { phoneLinks } from "@/lib/phone";

export interface AttentionEntry {
  classId: string;
  className: string;
  studentId: string;
  fullName: string;
  /** Chỉ dùng để dựng liên kết `tel:` ở server; component này là Server Component nên số không vào props client. */
  parentPhone: string | null;
  badge: React.ReactNode;
}

/** Các em cần chú ý, nhóm theo lớp; mỗi dòng có hồ sơ em + nút "Gọi phụ huynh" (hoặc nhắc chưa có số). */
export function AttentionGroups({ entries }: { entries: AttentionEntry[] }) {
  const groups = Map.groupBy(entries, (i) => i.classId);
  return [...groups.values()].map((list) => (
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
                {i.badge}
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
  ));
}
