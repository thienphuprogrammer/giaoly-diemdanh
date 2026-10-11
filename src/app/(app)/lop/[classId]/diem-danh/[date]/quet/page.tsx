import { notFound } from "next/navigation";
import { z } from "zod";
import { Notice } from "@/components/ui/Notice";
import { ScanScreen } from "@/components/scan/ScanScreen";
import { db } from "@/db/client";
import { getClassById } from "@/db/queries/classes";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { openSession } from "@/server/services/attendance";

export default async function ScanPage({ params }: { params: Promise<{ classId: string; date: string }> }) {
  const { classId, date } = await params;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canWrite) notFound();
  const opened = await openSession(db, user, { classId, heldOn: date }); // idempotent
  if (!opened.ok) return <Notice tone="error" role="alert">{opened.error}</Notice>;
  const cls = await getClassById(db, classId);
  return <ScanScreen sessionId={opened.data.id} classId={classId} className={cls?.name ?? ""} heldOn={date} />;
}
