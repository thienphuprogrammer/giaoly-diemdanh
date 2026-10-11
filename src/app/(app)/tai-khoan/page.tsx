import { redirect } from "next/navigation";
import { deleteSession, requireUser } from "@/lib/auth/dal";

export default async function AccountPage() {
  const user = await requireUser();
  async function logout() {
    "use server";
    await deleteSession();
    redirect("/login");
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tài khoản</h1>
      <p>{user.name}<br /><span className="text-ink-soft">{user.email}</span></p>
      {user.isGradeHead && <p className="text-sm text-brand">Trưởng khối</p>}
      <form action={logout}>
        <button className="h-12 w-full rounded-xl border border-line bg-card font-medium">Đăng xuất</button>
      </form>
    </section>
  );
}
