import { z } from "zod";
import {
  AUDIT_LOG_GROUPS, listAuditRows, listScanRows, type AuditLogGroup, type AuditLogQuery,
} from "@/db/queries/audit";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { decodeCursor, encodeCursor } from "@/lib/audit/cursor";
import { describeAuditEvent, describeScanEvent } from "@/lib/audit/describe";
import { shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { guardClass } from "../guard";

export const AUDIT_LOG_MAX_LIMIT = 50;
const VN_OFFSET = "+07:00"; // Asia/Ho_Chi_Minh không đổi giờ theo mùa

export interface AuditLogItem {
  /** `audit_events.id` hoặc `attendance_scans.event_id` (duy nhất trong phạm vi một nguồn; dùng cùng `source` làm khoá). */
  id: string;
  source: "audit" | "scan";
  at: Date;
  /** Ngày theo giờ Việt Nam (YYYY-MM-DD), để chia nhóm theo ngày. */
  day: string;
  actor: string;
  what: string;
  text: string;
  entity: string;
  action: string;
}

export interface AuditLogPage {
  items: AuditLogItem[];
  nextCursor: string | null;
}

const isoDay = z.string().refine((v) => shortDate(v) !== v, "bad day");
const inputSchema = z.object({
  classId: z.string(),
  from: isoDay.optional().catch(undefined),
  to: isoDay.optional().catch(undefined),
  group: z.enum(AUDIT_LOG_GROUPS).catch("all").default("all"),
  cursor: z.unknown().optional(),
  limit: z.number().int().catch(AUDIT_LOG_MAX_LIMIT).default(AUDIT_LOG_MAX_LIMIT),
});

const startOfDay = (day: string) => new Date(`${day}T00:00:00${VN_OFFSET}`).toISOString();
function startOfNextDay(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return startOfDay(next.toISOString().slice(0, 10));
}

interface Merged { sortAt: string; id: string; item: AuditLogItem }

const parseAt = (atKey: string) => new Date(atKey);
const newestFirst = (a: Merged, b: Merged) =>
  a.sortAt === b.sortAt ? (a.id === b.id ? 0 : a.id < b.id ? 1 : -1) : a.sortAt < b.sortAt ? 1 : -1;

/**
 * Nhật ký của một lớp (spec §2): `audit_events` hợp nhất với lượt quét (`attendance_scans`, chỉ lượt đã áp dụng), mới nhất
 * trước, phân trang keyset (thời điểm, id). Hai nguồn được truy vấn với CÙNG mốc và mỗi nguồn lấy `limit + 1` dòng; `limit + 1`
 * dòng mới nhất của phần hợp nhất luôn nằm trong hợp của hai nhóm đó, nên ghép lại đúng qua mọi ranh giới trang.
 * Quyền đọc = người đọc được lớp; null (như "không tồn tại") nếu không. Sự kiện cấp khối (`class_id` rỗng) không vào đây.
 */
export async function listAuditLog(db: Db, user: AppUser, raw: unknown): Promise<AuditLogPage | null> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { classId, from, to, group, cursor } = parsed.data;
  if (!(await guardClass(db, user, classId, "read"))) return null;
  const limit = Math.min(Math.max(parsed.data.limit, 1), AUDIT_LOG_MAX_LIMIT);
  const bound = decodeCursor(cursor);
  const q: AuditLogQuery = {
    classId, group, limit: limit + 1,
    from: from ? startOfDay(from) : undefined,
    to: to ? startOfNextDay(to) : undefined,
    before: bound ?? undefined,
  };
  const [auditRows, scanRows] = await Promise.all([listAuditRows(db, q), listScanRows(db, q)]);

  const merged: Merged[] = [
    ...auditRows.map((r): Merged => {
      const d = describeAuditEvent({ action: r.action, actorName: r.actorName, summary: r.summary });
      const at = parseAt(r.atKey);
      return { sortAt: r.atKey, id: r.id, item: { id: r.id, source: "audit", at, day: todayInVietnam(at), actor: d.actor, what: d.what, text: d.text, entity: r.entity, action: r.action } };
    }),
    ...scanRows.map((r): Merged => {
      const d = describeScanEvent(r);
      const at = parseAt(r.atKey);
      return { sortAt: r.atKey, id: r.id, item: { id: r.id, source: "scan", at, day: todayInVietnam(at), actor: d.actor, what: d.what, text: d.text, entity: "scan", action: `scan.${r.kind}` } };
    }),
  ].sort(newestFirst);

  const page = merged.slice(0, limit);
  const last = page[limit - 1];
  const nextCursor = merged.length > limit && last ? encodeCursor({ at: last.sortAt, id: last.id }) : null;
  return { items: page.map((m) => m.item), nextCursor };
}

export type { AuditLogGroup };
