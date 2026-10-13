import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { ClassTabs } from "@/components/nav/ClassTabs";
import { requireUser } from "@/lib/auth/dal";
import { guardClass } from "@/server/guard";

export default async function ClassLayout({ children, params }: { children: React.ReactNode; params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  if (!(await guardClass(db, user, classId, "read"))) notFound();
  const cls = await getClassById(db, classId);
  if (!cls) notFound();
  return (
    <div className="flex flex-col gap-6">
      <header className="sticky top-safe z-20 print:hidden -mx-4 -mt-6 border-b border-border bg-surface px-4 pt-3 sm:-mx-6 sm:px-6 lg:top-16 lg:mx-0 lg:mt-0 lg:rounded-t-card lg:border lg:px-5">
        <div className="flex min-h-11 items-center gap-1">
          <Link href={`/lop?schoolYearId=${cls.schoolYearId}`} aria-label="Về danh sách lớp" className="btn btn-ghost btn-icon -ml-2.5 shrink-0">
            <ChevronLeft aria-hidden size={24} />
          </Link>
          <div className="min-w-0 flex-1 py-1">
            <h1 className="truncate text-xl font-semibold">{cls.name}</h1>
            <p className="text-sm text-ink-soft">Năm học {cls.schoolYearName}</p>
          </div>
        </div>
        <ClassTabs classId={classId} />
      </header>
      {children}
    </div>
  );
}
