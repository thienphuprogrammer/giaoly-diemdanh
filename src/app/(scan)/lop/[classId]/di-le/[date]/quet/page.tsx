import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/Notice";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { isFromBoard } from "@/lib/scan-return";
import { classPermissions } from "@/server/guard";
import { openMassSession } from "@/server/services/mass-sessions";

/**
 * Đi lễ "cách 2": quét thẻ tại nhà thờ cho buổi `mass` của ngày `date` (Chúa nhật; ngày lễ khác chỉ khi `?manual=1`).
 * Cùng quyền với máy quét buổi học: phải là GLV được phân công lớp (không thì 404).
 */
export default async function MassScanPage({ params, searchParams }: {
  params: Promise<{ classId: string; date: string }>;
  searchParams: Promise<{ from?: string | string[]; manual?: string | string[] }>;
}) {
  const { classId, date } = await params;
  const { from, manual } = await searchParams;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canWrite) notFound();
  const isManual = manual === "1";
  const opened = await openMassSession(db, user, { classId, heldOn: date, manual: isManual }); // idempotent
  if (!opened.ok) return <div className="p-4"><Notice tone="error" role="alert">{opened.error}</Notice></div>;
  const cls = await getClassById(db, classId);
  const selfHref = `/lop/${classId}/di-le/${date}/quet${isManual ? "?manual=1" : ""}`;
  return (
    <ScanScreen kind="mass" sessionId={opened.data.id} userId={user.id} classId={classId} className={cls?.name ?? ""} heldOn={date}
      fromBoard={isFromBoard(from)} exitHref={`/lop/${classId}`} selfHref={selfHref} />
  );
}
