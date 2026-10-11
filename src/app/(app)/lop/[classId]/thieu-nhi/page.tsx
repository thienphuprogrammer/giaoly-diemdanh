import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { ImportCsv } from "./ImportCsv";
import { StudentForm } from "./StudentForm";
import { StudentRow } from "./StudentRow";

export default async function StudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const list = await listStudents(db, classId, true);
  return (
    <section className="flex flex-col gap-4">
      {perms.canWrite && <StudentForm classId={classId} />}
      {perms.canWrite && <ImportCsv classId={classId} />}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
        {list.map((s) => (
          <StudentRow key={s.id} classId={classId} canWrite={perms.canWrite}
            student={{ id: s.id, saintName: s.saintName, fullName: s.fullName, birthDate: s.birthDate, parentPhone: s.parentPhone, note: s.note, active: s.active }} />
        ))}
      </ul>
    </section>
  );
}
