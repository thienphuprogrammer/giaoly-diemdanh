"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "", label: "Điểm danh" },
  { slug: "/thieu-nhi", label: "Thiếu nhi" },
  { slug: "/so-do", label: "Sơ đồ" },
  { slug: "/thong-ke", label: "Thống kê" },
];

export function ClassTabs({ classId }: { classId: string }) {
  const path = usePathname();
  const base = `/lop/${classId}`;
  return (
    <div role="tablist" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4">
      {TABS.map((t) => {
        const href = base + t.slug;
        const active = t.slug === "" ? path === base || path.startsWith(`${base}/diem-danh`) : path.startsWith(href);
        return (
          <Link key={t.slug} href={href} role="tab" aria-selected={active}
            className={`flex h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium ${active ? "border-brand text-brand" : "border-transparent text-ink-soft"}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
