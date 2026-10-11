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
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{cls.name}</h1>
      <ClassTabs classId={classId} />
      {children}
    </div>
  );
}
