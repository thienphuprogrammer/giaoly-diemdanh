import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { setStudentActiveAction } from "./actions";
import { ImportCsv } from "./ImportCsv";
import { StudentForm } from "./StudentForm";

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
          <li key={s.id} className={`flex min-h-14 items-center justify-between px-4 py-2 ${s.active ? "" : "opacity-50"}`}>
            <span>
              <span className="block font-medium">{s.saintName ? `${s.saintName} ` : ""}{s.fullName}</span>
              <span className="text-sm text-ink-soft">{[s.birthDate, s.parentPhone].filter(Boolean).join(" · ")}{s.active ? "" : " · đã ẩn"}</span>
            </span>
            {perms.canWrite && (
              <form action={async () => { "use server"; await setStudentActiveAction(classId, s.id, !s.active); }}>
                <button className="h-11 rounded-lg px-3 text-sm text-ink-soft">{s.active ? "Ẩn" : "Hiện"}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
