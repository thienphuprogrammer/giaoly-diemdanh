import { CalendarDays } from "lucide-react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { findSession } from "@/db/queries/attendance";
import { EmptyState } from "@/components/ui/EmptyState";
import { Notice } from "@/components/ui/Notice";
import { requireUser } from "@/lib/auth/dal";
import { dateLabel } from "@/lib/date-label";
import { classPermissions } from "@/server/guard";
import { openSession, readBoard } from "@/server/services/attendance";
import { AttendanceBoard } from "./AttendanceBoard";

export default async function AttendancePage({ params }: { params: Promise<{ classId: string; date: string }> }) {
  const { classId, date } = await params;
  if (!z.iso.date().safeParse(date).success) notFound();
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();

  let sessionId: string;
  if (perms.canWrite) {
    // Mở buổi là idempotent (một buổi/lớp/ngày), nên an toàn khi gọi lúc render.
    const opened = await openSession(db, user, { classId, heldOn: date });
    if (!opened.ok) return <Notice tone="error" role="alert">{opened.error}</Notice>;
    sessionId = opened.data.id;
  } else {
    const existing = await findSession(db, classId, date);
    if (!existing) return (
      <EmptyState icon={CalendarDays} title={`Chưa có buổi điểm danh ngày ${dateLabel(date)}`}>
        Giáo lý viên phụ trách lớp sẽ mở buổi này khi điểm danh.
      </EmptyState>
    );
    sessionId = existing.id;
  }
  const board = await readBoard(db, user, sessionId);
  if (!board) notFound();
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-display text-sm font-medium text-ink-soft">Buổi điểm danh</p>
        <h2 className="mt-0.5 text-xl font-semibold">{dateLabel(date)}</h2>
      </div>
      <AttendanceBoard board={board} renderId={crypto.randomUUID()} />
    </section>
  );
}
