"use client";
import { CircleUser, GraduationCap, House, ShieldCheck, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/ui/BrandMark";
import { Avatar } from "@/components/ui/Avatar";

const ITEMS: { href: string; label: string; icon: LucideIcon; headOnly?: boolean; adminOnly?: boolean }[] = [
  { href: "/", label: "Trang chủ", icon: House },
  { href: "/lop", label: "Lớp của tôi", icon: GraduationCap },
  { href: "/can-chu-y", label: "Cần chú ý", icon: TriangleAlert },
  { href: "/khoi", label: "Khối", icon: Users, headOnly: true },
  { href: "/quan-tri", label: "Quản trị", icon: ShieldCheck, adminOnly: true },
  { href: "/tai-khoan", label: "Tài khoản", icon: CircleUser },
];

export function BottomNav({ isGradeHead, isAdmin = false, userName }: { isGradeHead: boolean; isAdmin?: boolean; userName: string }) {
  const path = usePathname();
  return (
    <>
    <header className="fixed inset-x-0 top-0 z-30 hidden h-16 items-center justify-between gap-6 bg-chrome px-6 text-white lg:flex print:hidden">
      <Link href="/" className="flex min-h-11 items-center gap-3 rounded-control focus-visible:outline-white">
        <BrandMark size={34} />
        <span className="text-base font-semibold">Điểm danh Giáo lý</span>
      </Link>
      <Link href="/tai-khoan" className="flex min-h-11 items-center gap-3 rounded-control px-3 text-sm transition-colors hover:bg-white/10 focus-visible:outline-white">
        <CircleUser aria-hidden size={20} />
        <span className="max-w-64 truncate">{userName}</span>
      </Link>
    </header>
    <nav aria-label="Điều hướng chính"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-safe lg:top-16 lg:right-auto lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-t-0 lg:px-3 lg:pb-5 lg:pt-6 print:hidden">
      <ul className="mx-auto flex w-full max-w-3xl lg:flex-col lg:gap-1">
        {ITEMS.filter((i) => (!i.headOnly || (isGradeHead && !isAdmin)) && (!i.adminOnly || isAdmin)).map((i) => {
          const active = i.href === "/" ? path === "/" : path === i.href || path.startsWith(`${i.href}/`);
          const Icon = i.icon;
          return (
            <li key={i.href} className="flex-1 lg:flex-none">
              <Link href={i.href} aria-current={active ? "page" : undefined}
                className={`group relative flex h-16 flex-col items-center justify-center gap-1 font-display text-xs font-medium outline-offset-[-3px] transition-colors lg:h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-control lg:px-3 lg:text-sm ${active ? "text-action lg:bg-action-tint" : "text-ink-soft hover:text-ink lg:hover:bg-surface-muted"}`}>
                <span aria-hidden className={`absolute inset-x-5 top-0 h-[3px] rounded-b-full transition-colors lg:hidden ${active ? "bg-action" : "bg-transparent"}`} />
                <span className={`flex h-7 w-12 items-center justify-center rounded-control transition-colors lg:w-6 ${active ? "bg-action-tint" : "group-hover:bg-surface-muted"}`}>
                  <Icon aria-hidden size={20} strokeWidth={active ? 2.25 : 2} />
                </span>
                {i.href === "/lop" && isAdmin ? "Tất cả lớp" : i.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto hidden items-center gap-3 border-t border-border px-2 pt-5 lg:flex">
        <Avatar name={userName} />
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium">{userName}</span>
          <span className="block text-xs text-ink-soft">{isAdmin ? "Quản trị viên" : isGradeHead ? "Trưởng khối" : "Giáo lý viên"}</span>
        </span>
      </div>
    </nav>
    </>
  );
}
