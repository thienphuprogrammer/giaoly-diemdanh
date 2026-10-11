import { BottomNav } from "@/components/nav/BottomNav";
import { requireUser } from "@/lib/auth/dal";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col">
      <main className="flex-1 px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-6 sm:px-6">{children}</main>
      <BottomNav isGradeHead={user.isGradeHead} />
    </div>
  );
}
