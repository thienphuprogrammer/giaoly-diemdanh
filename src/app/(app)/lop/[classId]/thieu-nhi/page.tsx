import { QrCode, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { db } from "@/db/client";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { RosterTools } from "./RosterTools";
import { StudentList } from "./StudentList";

export default async function StudentsPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const list = await listStudents(db, classId, true);
  const current = list.filter((s) => !s.former);
  const active = current.filter((s) => s.active).length;
  const former = list.length - current.length;
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Danh sách thiếu nhi</h2>
        <p className="mt-0.5 text-sm text-ink-soft">
          <span className="tabular-nums">{active}</span> em đang học{current.length > active ? ` · ${current.length - active} em đã ẩn` : ""}{former > 0 ? ` · ${former} em đã chuyển lớp` : ""}
        </p>
        {former > 0 && <p className="mt-1 text-sm text-ink-soft">Các em đã chuyển lớp được giữ lại để xem lịch sử năm học; thông tin chỉ sửa được ở lớp hiện tại.</p>}
      </div>
      {perms.canWrite && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <RosterTools classId={classId} />
          <Link href={`/lop/${classId}/thieu-nhi/the-qr`} className="btn btn-secondary">
            <QrCode aria-hidden size={20} /> In thẻ QR
          </Link>
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState icon={UsersRound} title="Lớp chưa có thiếu nhi">
          {perms.canWrite ? "Bấm \"Thêm em\" để nhập từng em, hoặc \"Nhập CSV\" để thêm cả lớp một lần." : "Giáo lý viên phụ trách lớp sẽ thêm danh sách."}
        </EmptyState>
      ) : (
        <StudentList classId={classId} canWrite={perms.canWrite}
          students={list.map((s) => ({ id: s.id, saintName: s.saintName, fullName: s.fullName, birthDate: s.birthDate, parentPhone: s.parentPhone, note: s.note, active: s.active, former: s.former }))} />
      )}
    </section>
  );
}
