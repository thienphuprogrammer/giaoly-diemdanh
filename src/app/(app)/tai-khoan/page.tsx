import { ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/nav/LogoutButton";
import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Pill";
import { deleteSession, requireUser } from "@/lib/auth/dal";

export default async function AccountPage() {
  const user = await requireUser();
  async function logout() {
    "use server";
    await deleteSession();
    redirect("/login");
  }
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Tài khoản</h1>
      <div className="card flex items-center gap-4 p-4">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="break-words font-display text-lg font-semibold">{user.name}</p>
          <p className="break-all text-sm text-ink-soft">{user.email}</p>
          {user.isGradeHead && <Pill tone="action" icon={ShieldCheck} className="mt-2">Trưởng khối</Pill>}
        </div>
      </div>
      <LogoutButton userId={user.id} action={logout} />
    </section>
  );
}
