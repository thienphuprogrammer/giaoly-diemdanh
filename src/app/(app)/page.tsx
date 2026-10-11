import Link from "next/link";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";

export default async function HomePage() {
  const user = await requireUser();
  const classes = await listClassesForUser(db, user);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Lớp của tôi</h1>
      {classes.length === 0 && <p className="text-ink-soft">Bạn chưa được gán lớp nào. Hãy nhờ trưởng khối gán lớp.</p>}
      <ul className="flex flex-col gap-3">
        {classes.map((c) => (
          <li key={c.id}>
            <Link href={`/lop/${c.id}`} className="flex min-h-16 items-center justify-between rounded-2xl border border-line bg-card p-4 shadow-sm">
              <span>
                <span className="block text-lg font-semibold">{c.name}</span>
                <span className="text-sm text-ink-soft">{c.studentCount} em{c.canWrite ? "" : " · chỉ xem"}</span>
              </span>
              <span aria-hidden className="text-brand">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
