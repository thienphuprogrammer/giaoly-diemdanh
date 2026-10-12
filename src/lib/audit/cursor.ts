import { z } from "@/lib/zod";

/** Mốc phân trang keyset của nhật ký: thời điểm (ISO UTC, đủ micro giây) + id dòng cuối trang. */
export interface AuditCursor { at: string; id: string }

const ISO_MICROS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const cursorSchema = z.object({ a: z.string().regex(ISO_MICROS), i: z.uuid() }).strict();

/** Không trong suốt với người dùng (base64url của JSON); không có bí mật nào trong đó. */
export function encodeCursor(c: AuditCursor): string {
  return Buffer.from(JSON.stringify({ a: c.at, i: c.id }), "utf8").toString("base64url");
}

/** null khi sai dạng/bị sửa: người gọi quay về trang đầu thay vì lỗi. */
export function decodeCursor(raw: unknown): AuditCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data.a))) return null;
    return { at: parsed.data.a, id: parsed.data.i.toLowerCase() };
  } catch {
    return null;
  }
}
