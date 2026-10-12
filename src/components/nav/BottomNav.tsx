"use client";
import { CircleUser, House, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; icon: LucideIcon; headOnly?: boolean }[] = [
  { href: "/", label: "Lớp của tôi", icon: House },
  { href: "/can-chu-y", label: "Cần chú ý", icon: TriangleAlert },
  { href: "/khoi", label: "Khối", icon: Users, headOnly: true },
  { href: "/tai-khoan", label: "Tài khoản", icon: CircleUser },
];

export function BottomNav({ isGradeHead }: { isGradeHead: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-border bg-surface pb-safe shadow-bar">
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.filter((i) => !i.headOnly || isGradeHead).map((i) => {
          const active = i.href === "/" ? path === "/" || path.startsWith("/lop") : path.startsWith(i.href);
          const Icon = i.icon;
          return (
            <li key={i.href} className="flex-1">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`group relative flex h-16 flex-col items-center justify-center gap-1 font-display text-xs font-medium outline-offset-[-3px] transition-colors ${active ? "text-action" : "text-ink-soft hover:text-ink"}`}>
                <span aria-hidden className={`absolute inset-x-5 top-0 h-[3px] rounded-b-full transition-colors ${active ? "bg-action" : "bg-transparent"}`} />
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-action-tint" : "group-hover:bg-surface-muted"}`}>
                  <Icon aria-hidden size={20} strokeWidth={active ? 2.25 : 2} />
                </span>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
