import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { findSession } from "@/db/queries/attendance";
import { requireUser } from "@/lib/auth/dal";
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
    if (!opened.ok) return <p role="alert" className="text-warn-alert">{opened.error}</p>;
    sessionId = opened.data.id;
  } else {
    const existing = await findSession(db, classId, date);
    if (!existing) return <p className="text-ink-soft">Chưa có buổi điểm danh ngày {date}.</p>;
    sessionId = existing.id;
  }
  const board = await readBoard(db, user, sessionId);
  if (!board) notFound();
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Buổi ngày {date}</h2>
      <AttendanceBoard board={board} />
    </section>
  );
}
