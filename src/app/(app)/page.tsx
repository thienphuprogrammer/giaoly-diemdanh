import { requireUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requireUser();
  return <h1 className="text-2xl font-semibold">Xin chào, {user.name}</h1>;
}
