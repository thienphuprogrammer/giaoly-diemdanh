"use client";
import { ChartColumn, ClipboardCheck, LayoutGrid, UsersRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { slug: string; label: string; icon: LucideIcon }[] = [
  { slug: "", label: "Điểm danh", icon: ClipboardCheck },
  { slug: "/thieu-nhi", label: "Thiếu nhi", icon: UsersRound },
  { slug: "/so-do", label: "Sơ đồ", icon: LayoutGrid },
  { slug: "/thong-ke", label: "Thống kê", icon: ChartColumn },
];

export function ClassTabs({ classId }: { classId: string }) {
  const path = usePathname();
  const base = `/lop/${classId}`;
  return (
    <div role="tablist" className="-mx-4 flex overflow-x-auto px-2 [scrollbar-width:none] sm:-mx-6 sm:px-4">
      {TABS.map((t) => {
        const href = base + t.slug;
        const active = t.slug === "" ? path === base || path.startsWith(`${base}/diem-danh`) : path.startsWith(href);
        const Icon = t.icon;
        return (
          <Link key={t.slug} href={href} role="tab" aria-selected={active}
            className={`relative flex h-12 min-w-max flex-1 items-center justify-center gap-1.5 px-2.5 font-display text-sm font-medium outline-offset-[-3px] transition-colors ${active ? "text-action" : "text-ink-soft hover:text-ink"}`}>
            <Icon aria-hidden size={16} strokeWidth={active ? 2.25 : 2} className="hidden sm:block" />
            {t.label}
            <span aria-hidden className={`absolute inset-x-2 bottom-0 h-[3px] rounded-t-full ${active ? "bg-action" : "bg-transparent"}`} />
          </Link>
        );
      })}
    </div>
  );
}
