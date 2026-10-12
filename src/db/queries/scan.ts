import { and, eq, inArray, sql } from "drizzle-orm";
import { attendance, attendanceScans, classCatechists, sessions, students } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

/** Một truy vấn: buổi + quyền ghi của người dùng + lượt đã có cùng event_id (nếu là gửi lại). */
export async function loadScanContext(db: Reader, userId: string, sessionId: string, eventId: string) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      classId: sessions.classId,
      cancelled: sessions.cancelled,
      kind: sessions.kind, // buổi đi lễ không có "đi muộn": kiểm tra ngay trong truy vấn này, không thêm lượt DB
      canWrite: sql<boolean>`exists (select 1 from ${classCatechists} where ${classCatechists.classId} = ${sessions.classId} and ${classCatechists.userId} = ${userId})`,
      event: attendanceScans,
    })
    .from(sessions)
    .leftJoin(attendanceScans, eq(attendanceScans.eventId, eventId))
    .where(eq(sessions.id, sessionId));
  if (!row) return null;
  return { ...row, event: row.event?.eventId ? row.event : null };
}

/** Một truy vấn: em (theo mã thẻ hoặc id) trong đúng lớp, đang hiện, kèm trạng thái hiện có trong buổi. */
export async function findScanTarget(
  db: Reader,
  ctx: { sessionId: string; classId: string },
  by: { token: string } | { studentId: string },
) {
  const match = "token" in by ? eq(students.qrToken, by.token) : eq(students.id, by.studentId);
  const [row] = await db
    .select({
      id: students.id,
      fullName: students.fullName,
      saintName: students.saintName,
      status: attendance.status,
      reason: attendance.reason,
      lastEventId: attendance.lastEventId,
    })
    .from(students)
    .leftJoin(attendance, and(eq(attendance.studentId, students.id), eq(attendance.sessionId, ctx.sessionId)))
    .where(and(match, eq(students.classId, ctx.classId), eq(students.active, true)));
  return row ?? null;
}

export const getScanEvent = async (db: Reader, eventId: string) =>
  (await db.select().from(attendanceScans).where(eq(attendanceScans.eventId, eventId)))[0] ?? null;

export const listScanEvents = (db: Reader, sessionId: string, eventIds: string[]) =>
  eventIds.length === 0
    ? Promise.resolve([])
    : db.select().from(attendanceScans).where(and(eq(attendanceScans.sessionId, sessionId), inArray(attendanceScans.eventId, eventIds)));

export const listClassTokens = (db: Reader, classId: string) =>
  db.select({ id: students.id, token: students.qrToken }).from(students).where(and(eq(students.classId, classId), eq(students.active, true)));

type Writer = Pick<Db, "update">;
type MarkValues = Partial<typeof attendance.$inferInsert>;

/**
 * Compare-and-set: chỉ ghi khi dòng vẫn đúng như lúc đọc (trạng thái, lý do, lượt quét gần nhất).
 * Không so `updatedAt`: giá trị mặc định có độ chính xác micro giây, đi qua Date của JS sẽ bị cắt.
 */
export async function updateMarkIfUnchanged(
  db: Writer,
  key: { sessionId: string; studentId: string },
  seen: { status: (typeof attendance.$inferSelect)["status"] | null; reason: string | null; lastEventId: string | null },
  values: MarkValues,
): Promise<boolean> {
  if (seen.status === null) return false;
  const written = await db.update(attendance).set(values)
    .where(and(
      eq(attendance.sessionId, key.sessionId),
      eq(attendance.studentId, key.studentId),
      eq(attendance.status, seen.status),
      sql`${attendance.reason} is not distinct from ${seen.reason}`,
      sql`${attendance.lastEventId} is not distinct from ${seen.lastEventId}`,
    ))
    .returning({ s: attendance.status });
  return written.length > 0;
}
