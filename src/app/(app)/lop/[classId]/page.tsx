import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { listSessions } from "@/db/queries/attendance";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { classPermissions } from "@/server/guard";
import { OpenDate } from "./OpenDate";

export default async function ClassHomePage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();
  const today = todayInVietnam();
  const sessions = await listSessions(db, classId);
  return (
    <section className="flex flex-col gap-4">
      {perms.canWrite && (
        <>
          {/* prefetch={false}: mở buổi tạo bản ghi, không được chạy khi chỉ prefetch */}
          <Link prefetch={false} href={`/lop/${classId}/diem-danh/${today}`}
            className="flex h-14 items-center justify-center rounded-2xl bg-brand text-lg font-semibold text-white">
            Điểm danh hôm nay
          </Link>
          <OpenDate classId={classId} today={today} />
        </>
      )}
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
        {sessions.length === 0 && <li className="p-4 text-ink-soft">Chưa có buổi nào.</li>}
        {sessions.map((s) => (
          <li key={s.id}>
            <Link prefetch={false} href={`/lop/${classId}/diem-danh/${s.heldOn}`} className="flex min-h-14 items-center justify-between px-4 py-2">
              <span className="font-medium">{s.heldOn}{s.cancelled ? " · nghỉ lễ" : ""}</span>
              <span className="text-sm text-ink-soft">{s.marked} đã điểm danh · {s.absent} vắng KP</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
