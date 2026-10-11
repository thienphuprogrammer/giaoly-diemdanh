"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Lớp của tôi" },
  { href: "/can-chu-y", label: "Cần chú ý" },
  { href: "/khoi", label: "Khối", headOnly: true },
  { href: "/tai-khoan", label: "Tài khoản" },
];

export function BottomNav({ isGradeHead }: { isGradeHead: boolean }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.filter((i) => !i.headOnly || isGradeHead).map((i) => {
          const active = i.href === "/" ? path === "/" || path.startsWith("/lop") : path.startsWith(i.href);
          return (
            <li key={i.href} className="flex-1">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center text-sm font-medium ${active ? "text-brand" : "text-ink-soft"}`}>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
