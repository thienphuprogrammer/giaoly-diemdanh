import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/Notice";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { isFromBoard } from "@/lib/scan-return";
import { classPermissions } from "@/server/guard";
import { openSession } from "@/server/services/attendance";

export default async function ScanPage({ params, searchParams }: {
  params: Promise<{ classId: string; date: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { classId, date } = await params;
  const { from } = await searchParams;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canWrite) notFound();
  const opened = await openSession(db, user, { classId, heldOn: date }); // idempotent
  if (!opened.ok) {
    return (
      <div className="p-4">
        <Notice tone="error" role="alert">
          <p>{opened.error}</p>
          <Link href={`/lop/${classId}`} className="btn btn-secondary btn-sm mt-2">Về trang lớp</Link>
        </Notice>
      </div>
    );
  }
  const cls = await getClassById(db, classId);
  return <ScanScreen sessionId={opened.data.id} userId={user.id} classId={classId} className={cls?.name ?? ""} heldOn={date} fromBoard={isFromBoard(from)} />;
}
