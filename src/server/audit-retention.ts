import { sql } from "drizzle-orm";
import { auditEvents } from "@/db/schema";
import type { Db } from "@/db/types";

/** Giữ nhật ký 12 tháng (spec §2). */
export const AUDIT_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;

/**
 * Dọn `audit_events` cũ hơn `olderThanDays` ngày (mặc định 365) tính từ `now`. KHÔNG đụng `attendance_scans` (nguồn quét có
 * vòng đời riêng) hay bất kỳ bảng dữ liệu nào khác. Dòng đúng bằng mốc được giữ. Không có xác thực ở đây: chỉ được gọi từ
 * route cron đã kiểm tra `CRON_SECRET` (Task 39). Từ chối cửa sổ không hợp lệ thay vì xoá nhầm cả bảng.
 */
export async function pruneAudit(
  db: Db,
  opts: { olderThanDays?: number; now?: Date } = {},
): Promise<{ deleted: number }> {
  const days = opts.olderThanDays ?? AUDIT_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1) throw new Error("pruneAudit: olderThanDays must be an integer >= 1");
  const cutoff = new Date((opts.now ?? new Date()).getTime() - days * DAY_MS);
  // Đếm trong SQL: không kéo hàng chục nghìn id về chỉ để lấy độ dài.
  const res: unknown = await db.execute(sql`
    with d as (delete from ${auditEvents} where ${auditEvents.at} < ${cutoff.toISOString()}::timestamptz returning 1)
    select count(*)::int as n from d`);
  const rows = (Array.isArray(res) ? res : (res as { rows: Record<string, unknown>[] }).rows) as Record<string, unknown>[];
  return { deleted: Number(rows[0]?.n ?? 0) };
}
