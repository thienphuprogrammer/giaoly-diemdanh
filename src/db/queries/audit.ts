import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { attendanceScans, auditEvents, sessions, students, users } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

/** Nhóm lọc của trang nhật ký ("loại"). `mass` = mọi thứ thuộc buổi đi lễ; `scan` = lượt quét/chọn tên/hoàn tác quét. */
export const AUDIT_LOG_GROUPS = ["all", "attendance", "mass", "student", "seating", "session", "scan"] as const;
export type AuditLogGroup = (typeof AUDIT_LOG_GROUPS)[number];

/** Mốc keyset: thời điểm đầy đủ micro giây (chuỗi ISO UTC) + id; so sánh từng dòng `(thời điểm, id)` giảm dần. */
export interface AuditBound { at: string; id: string }

export interface AuditLogQuery {
  classId: string;
  /** Nửa mở [from, to): mốc ISO. */
  from?: string;
  to?: string;
  group: AuditLogGroup;
  /** Chỉ lấy các dòng ĐỨNG SAU mốc này (cũ hơn) theo thứ tự (thời điểm, id) giảm dần. */
  before?: AuditBound;
  limit: number;
}

export interface AuditRow {
  id: string;
  /** ISO UTC đủ micro giây (`2026-10-12T05:00:00.123456Z`): ghép hai nguồn và phân trang không mất thứ tự khi trùng mili giây. */
  atKey: string;
  actorName: string | null;
  entity: (typeof auditEvents.$inferSelect)["entity"];
  action: string;
  summary: Record<string, unknown>;
}

export interface ScanRow {
  id: string;
  atKey: string;
  actorName: string | null;
  kind: (typeof attendanceScans.$inferSelect)["kind"];
  mode: string | null;
  prevStatus: string | null;
  newStatus: string | null;
  studentName: string | null;
  sessionDate: string;
  sessionKind: string;
}

const ISO_MICROS = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;
const massKind = sql`${auditEvents.summary}->>'sessionKind'`;
const notMass = sql`coalesce(${massKind}, 'class') <> 'mass'`;

function auditGroupFilter(group: AuditLogGroup): SQL | undefined {
  switch (group) {
    case "attendance": return and(eq(auditEvents.entity, "attendance"), notMass);
    case "mass": return sql`${massKind} = 'mass'`;
    case "student": return eq(auditEvents.entity, "student");
    case "seating": return eq(auditEvents.entity, "seating_plan");
    case "session": return and(eq(auditEvents.entity, "session"), notMass);
    default: return undefined;
  }
}

/** Dòng `audit_events` của đúng lớp (sự kiện cấp khối không có `class_id` nên không bao giờ vào đây), mới nhất trước. */
export async function listAuditRows(db: Reader, q: AuditLogQuery): Promise<AuditRow[]> {
  if (q.group === "scan") return [];
  return db
    .select({
      id: auditEvents.id,
      atKey: sql<string>`to_char(${auditEvents.at} at time zone 'UTC', ${sql.raw(`'${ISO_MICROS}'`)})`,
      actorName: users.name,
      entity: auditEvents.entity,
      action: auditEvents.action,
      summary: auditEvents.summary,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(
      eq(auditEvents.classId, q.classId),
      q.from ? gte(auditEvents.at, sql`${q.from}::timestamptz`) : undefined,
      q.to ? lt(auditEvents.at, sql`${q.to}::timestamptz`) : undefined,
      q.before ? sql`(${auditEvents.at}, ${auditEvents.id}) < (${q.before.at}::timestamptz, ${q.before.id}::uuid)` : undefined,
      auditGroupFilter(q.group),
    ))
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(q.limit);
}

/**
 * Lượt quét/chọn tên/hoàn tác ĐÃ ÁP DỤNG của các buổi thuộc lớp. `received_at` là `timestamp` không múi giờ lưu theo UTC
 * (như mọi nơi khác đọc cột này), nên mốc được so như UTC.
 */
export async function listScanRows(db: Reader, q: AuditLogQuery): Promise<ScanRow[]> {
  if (q.group !== "all" && q.group !== "scan" && q.group !== "mass") return [];
  const at = attendanceScans.receivedAt;
  return db
    .select({
      id: attendanceScans.eventId,
      atKey: sql<string>`to_char(${at}, ${sql.raw(`'${ISO_MICROS}'`)})`,
      actorName: users.name,
      kind: attendanceScans.kind,
      mode: attendanceScans.mode,
      prevStatus: attendanceScans.prevStatus,
      newStatus: attendanceScans.newStatus,
      studentName: students.fullName,
      sessionDate: sessions.heldOn,
      sessionKind: sessions.kind,
    })
    .from(attendanceScans)
    .innerJoin(sessions, eq(sessions.id, attendanceScans.sessionId))
    .leftJoin(students, eq(students.id, attendanceScans.studentId))
    .leftJoin(users, eq(users.id, attendanceScans.actorId))
    .where(and(
      eq(sessions.classId, q.classId),
      eq(attendanceScans.result, "applied"),
      q.group === "mass" ? eq(sessions.kind, "mass") : undefined,
      q.from ? gte(at, sql`(${q.from}::timestamptz at time zone 'UTC')`) : undefined,
      q.to ? lt(at, sql`(${q.to}::timestamptz at time zone 'UTC')`) : undefined,
      q.before ? sql`(${at}, ${attendanceScans.eventId}) < ((${q.before.at}::timestamptz at time zone 'UTC'), ${q.before.id}::uuid)` : undefined,
    ))
    .orderBy(desc(at), desc(attendanceScans.eventId))
    .limit(q.limit);
}
