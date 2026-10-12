import { sql, type SQLWrapper } from "drizzle-orm";
import { auditEvents } from "@/db/schema";
import type { Db } from "@/db/types";
import { entityOf, isAuditAction, sanitizeSummary, type AuditAction, type AuditEntity, type AuditSummary } from "@/lib/audit/events";

/**
 * Ghi nhật ký thay đổi (spec §2). Luôn gọi TRONG CÙNG transaction (hoặc cùng câu lệnh) với thay đổi, để rollback thì không
 * có dòng nhật ký; chỉ gọi khi dữ liệu thật sự đổi. `classId`/`gradeId` lấy từ dòng đã đọc ở server, không bao giờ từ client.
 */
export interface AuditEvent {
  actorId: string | null;
  classId?: string | null;
  gradeId?: string | null;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  summary: Record<string, unknown>;
}

export interface AuditRow {
  actorId: string | null;
  classId: string | null;
  gradeId: string | null;
  entity: AuditEntity;
  entityId: string | null;
  action: AuditAction;
  summary: AuditSummary;
}

/** Kiểm tra sự kiện (hành động đúng loại đối tượng, có phạm vi lớp/khối, `summary` an toàn) và dựng giá trị chèn. */
export function auditRow(event: AuditEvent): AuditRow {
  if (!isAuditAction(event.action)) throw new Error("audit: unknown action");
  if (entityOf(event.action) !== event.entity) throw new Error("audit: action does not belong to entity");
  const classId = event.classId ?? null;
  const gradeId = event.gradeId ?? null;
  if (classId === null && gradeId === null) throw new Error("audit: event needs a class or grade scope");
  return {
    actorId: event.actorId, classId, gradeId, entity: event.entity, entityId: event.entityId ?? null, action: event.action,
    summary: sanitizeSummary(event.summary),
  };
}

/** Chèn một dòng nhật ký bằng `db` hoặc transaction `tx` của thay đổi. */
export async function recordAudit(db: Db, event: AuditEvent): Promise<void> {
  await db.insert(auditEvents).values(auditRow(event));
}

type ExecuteResult = Record<string, unknown>[] | { rows: Record<string, unknown>[] };
const rowsOf = (res: unknown): Record<string, unknown>[] =>
  Array.isArray(res) ? res : (res as Extract<ExecuteResult, { rows: unknown }>).rows;

/**
 * Đường nóng (chạm tay trên bảng): chạy `write` (câu lệnh ghi có RETURNING) và chèn nhật ký trong MỘT câu lệnh
 * (CTE ghi dữ liệu) — nguyên tử như transaction mà không thêm lượt khứ hồi BEGIN/COMMIT. Chỉ ghi nhật ký khi `write`
 * trả về ít nhất một dòng. Trả về số dòng `write` trả về.
 */
export async function writeWithAudit(db: Db, write: SQLWrapper, event: AuditEvent): Promise<number> {
  const row = auditRow(event);
  const res: unknown = await db.execute(sql`
    with w as (${write.getSQL()}),
    a as (
      insert into ${auditEvents} (actor_id, class_id, grade_id, entity, entity_id, action, summary)
      select ${row.actorId}::uuid, ${row.classId}::uuid, ${row.gradeId}::uuid, ${row.entity}::audit_entity,
        ${row.entityId}::text, ${row.action}::text, ${JSON.stringify(row.summary)}::jsonb
      where exists (select 1 from w)
      returning 1
    )
    select count(*)::int as n from w`);
  return Number(rowsOf(res)[0]?.n ?? 0);
}
