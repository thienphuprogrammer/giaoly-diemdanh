import { BottomNav } from "@/components/nav/BottomNav";
import { requireUser } from "@/lib/auth/dal";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-dvh lg:pl-60 lg:pt-16 print:pl-0 print:pt-0">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:text-action print:hidden">Đến nội dung chính</a>
      <main id="main-content" tabIndex={-1} className="mx-auto min-w-0 max-w-3xl px-4 pb-safe-26 pt-safe-6 sm:px-6 lg:max-w-[1440px] lg:px-8 lg:pb-10 lg:pt-8 xl:px-10 print:max-w-none print:px-0 print:pb-0">{children}</main>
      <BottomNav isGradeHead={user.isGradeHead} isAdmin={user.isAdmin} userName={user.name} />
    </div>
  );
}
