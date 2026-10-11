import { QrCode, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { db } from "@/db/client";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { RosterTools } from "./RosterTools";
import { StudentRow } from "./StudentRow";

export default async function StudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const list = await listStudents(db, classId, true);
  const active = list.filter((s) => s.active).length;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Danh sách thiếu nhi</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          <span className="tabular-nums">{active}</span> em đang học{list.length > active ? ` · ${list.length - active} em đã ẩn` : ""}
        </p>
      </div>
      {perms.canWrite && <RosterTools classId={classId} />}
      {perms.canWrite && (
        <Link href={`/lop/${classId}/thieu-nhi/the-qr`} className="btn btn-secondary">
          <QrCode aria-hidden size={20} /> In thẻ QR
        </Link>
      )}
      {list.length === 0 ? (
        <EmptyState icon={UsersRound} title="Lớp chưa có thiếu nhi">
          {perms.canWrite ? "Bấm \"Thêm em\" để nhập từng em, hoặc \"Nhập CSV\" để thêm cả lớp một lần." : "Giáo lý viên phụ trách lớp sẽ thêm danh sách."}
        </EmptyState>
      ) : (
        <ul className="card flex flex-col divide-y divide-border overflow-hidden">
          {list.map((s) => (
            <StudentRow key={s.id} classId={classId} canWrite={perms.canWrite}
              student={{ id: s.id, saintName: s.saintName, fullName: s.fullName, birthDate: s.birthDate, parentPhone: s.parentPhone, note: s.note, active: s.active }} />
          ))}
        </ul>
      )}
    </section>
  );
}
