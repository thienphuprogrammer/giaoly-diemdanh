import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { THRESHOLD_KINDS } from "@/lib/reminders/messages";
import { attendance, classCatechists, classes, notificationLog, pushSubscriptions, sessions, students, users } from "../schema";
import type { Db } from "../types";
import { listTerms } from "./stats";

/** Truy vấn cho tác vụ nhắc việc (Task 39). Không bao giờ chọn `qr_token`; tên/SĐT của em không rời khỏi tầng này. */

// Viết rõ tên bảng: drizzle bỏ tiền tố bảng khi truy vấn chỉ có một bảng, khi đó "id" trong truy vấn con sẽ trỏ nhầm.
const hasDevice = sql<boolean>`exists (select 1 from ${pushSubscriptions} ps where ps.user_id = "users"."id")`;

export interface ScheduledClass {
  id: string;
  name: string;
  meetsOn: number | null;
  meetsAt: string | null;
  /** Buổi HỌC hôm nay đã bị huỷ (nghỉ lễ). */
  cancelled: boolean;
  /** Buổi HỌC hôm nay đã có ít nhất một dòng điểm danh. */
  marked: boolean;
}

/**
 * Lớp học vào `weekday` và còn ít nhất một em đang học, kèm trạng thái buổi học (`kind='class'`) của ngày `date`. Buổi
 * đi lễ không được tính. Lớp trống (vd. cả lớp đã lên lớp) không được nhắc.
 */
export async function scheduledClasses(db: Db, weekday: number, date: string): Promise<ScheduledClass[]> {
  const rows = await db
    .select({
      id: classes.id, name: classes.name, meetsOn: classes.meetsOn, meetsAt: classes.meetsAt,
      cancelled: sql<boolean>`coalesce(${sessions.cancelled}, false)`,
      marked: sql<boolean>`exists (select 1 from ${attendance} where ${attendance.sessionId} = ${sessions.id})`,
    })
    .from(classes)
    .leftJoin(sessions, and(eq(sessions.classId, classes.id), eq(sessions.heldOn, date), eq(sessions.kind, "class")))
    .where(and(
      eq(classes.meetsOn, weekday), isNotNull(classes.meetsAt),
      sql`exists (select 1 from ${students} st where st.class_id = ${classes.id} and st.active)`,
    ))
    .orderBy(asc(classes.name), asc(classes.id));
  return rows.map((r) => ({ ...r, cancelled: Boolean(r.cancelled), marked: Boolean(r.marked) }));
}

export interface Recipient { userId: string; hasDevice: boolean }

/** GLV được phân công (quyền ghi) của các lớp. */
export async function catechistsOf(db: Db, classIds: string[]): Promise<(Recipient & { classId: string })[]> {
  if (classIds.length === 0) return [];
  const rows = await db
    .select({ classId: classCatechists.classId, userId: users.id, hasDevice })
    .from(classCatechists)
    .innerJoin(users, eq(users.id, classCatechists.userId))
    .where(inArray(classCatechists.classId, classIds))
    .orderBy(asc(users.id));
  return rows.map((r) => ({ ...r, hasDevice: Boolean(r.hasDevice) }));
}

/** Mọi trưởng khối có khối. */
export async function gradeHeads(db: Db): Promise<(Recipient & { gradeId: string })[]> {
  const rows = await db
    .select({ userId: users.id, gradeId: users.gradeId, hasDevice })
    .from(users)
    .where(and(eq(users.isGradeHead, true), isNotNull(users.gradeId)))
    .orderBy(asc(users.id));
  return rows.flatMap((r) => (r.gradeId ? [{ userId: r.userId, gradeId: r.gradeId, hasDevice: Boolean(r.hasDevice) }] : []));
}

/** Học kỳ chứa `today` (không lấy học kỳ gần nhất như `resolveTerm`: thông báo chỉ cho học kỳ đang diễn ra). */
export async function currentTerm(db: Db, today: string) {
  return (await listTerms(db)).find((t) => t.startsOn <= today && today <= t.endsOn) ?? null;
}

/** Lớp (id, tên, khối) của các khối cho trước — chỉ cho thông báo ngưỡng. */
export const classNamesOfGrades = (db: Db, gradeIds: string[]) =>
  gradeIds.length === 0
    ? Promise.resolve([])
    : db.select({ id: classes.id, name: classes.name, gradeId: classes.gradeId }).from(classes).where(inArray(classes.gradeId, gradeIds));

/**
 * Nhận trước khi gửi: chèn dòng `notification_log` (on conflict do nothing) và trả về các khoá VỪA được nhận. Hai lần
 * chạy chồng nhau không thể cùng nhận một khoá (khoá duy nhất `(kind, target_key, user_id)` NULLS NOT DISTINCT).
 */
export async function claimNotifications(db: Db, kind: string, targetKeys: readonly string[], userId: string | null): Promise<Set<string>> {
  if (targetKeys.length === 0) return new Set();
  const rows = await db.insert(notificationLog)
    .values(targetKeys.map((targetKey) => ({ kind, targetKey, userId })))
    .onConflictDoNothing()
    .returning({ targetKey: notificationLog.targetKey });
  return new Set(rows.map((r) => r.targetKey));
}

export async function releaseNotification(db: Db, kind: string, targetKey: string, userId: string | null): Promise<void> {
  await db.delete(notificationLog).where(and(
    eq(notificationLog.kind, kind), eq(notificationLog.targetKey, targetKey),
    userId === null ? sql`${notificationLog.userId} is null` : eq(notificationLog.userId, userId),
  ));
}

/** Giữ nhật ký nhắc điểm danh/dọn dẹp 120 ngày. */
export const NOTIFICATION_LOG_RETENTION_DAYS = 120;
/**
 * Thông báo ngưỡng là "một lần mỗi em mỗi học kỳ": học kỳ có thể dài hơn 120 ngày, xoá sớm sẽ báo lại trong cùng học kỳ.
 * Giữ hơn một năm học.
 */
export const THRESHOLD_LOG_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;

export async function pruneNotificationLog(db: Db, now: Date): Promise<number> {
  const short = new Date(now.getTime() - NOTIFICATION_LOG_RETENTION_DAYS * DAY_MS).toISOString();
  const long = new Date(now.getTime() - THRESHOLD_LOG_RETENTION_DAYS * DAY_MS).toISOString();
  const kinds = sql.join(THRESHOLD_KINDS.map((k) => sql`${k}`), sql`, `);
  const res: unknown = await db.execute(sql`
    with d as (
      delete from ${notificationLog}
      where (${notificationLog.kind} in (${kinds}) and ${notificationLog.sentAt} < ${long}::timestamptz)
         or (${notificationLog.kind} not in (${kinds}) and ${notificationLog.sentAt} < ${short}::timestamptz)
      returning 1)
    select count(*)::int as n from d`);
  const rows = (Array.isArray(res) ? res : (res as { rows: Record<string, unknown>[] }).rows) as Record<string, unknown>[];
  return Number(rows[0]?.n ?? 0);
}
