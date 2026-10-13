import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { readSession } from "./session";
import { sessionRevokedByPasswordChange } from "./session-policy";

/**
 * Người dùng của một cookie phiên, đọc lại từ DB (một truy vấn): đổi quyền/khóa/xóa tài khoản có hiệu lực ngay, và phiên
 * đăng nhập TRƯỚC lần đổi/đặt lại mật khẩu gần nhất bị từ chối (dùng chính hàng user vừa đọc, không thêm truy vấn).
 * Proxy chỉ kiểm chữ ký/hạn/trần 90 ngày và giữ nguyên `sat` khi gia hạn, nên không "hồi sinh" được phiên đã thu hồi.
 */
export async function loadSessionUser(db: Db, token: string | undefined, secret: string): Promise<AppUser | null> {
  const session = await readSession(token, secret);
  if (!session) return null;
  const [row] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!row || !row.isActive || session.ver !== row.sessionVersion || sessionRevokedByPasswordChange(session.sat, row.passwordChangedAt)) return null;
  return { id: row.id, email: row.email, name: row.name, isAdmin: row.isAdmin, sessionVersion: row.sessionVersion, isGradeHead: row.isGradeHead, gradeId: row.gradeId };
}
