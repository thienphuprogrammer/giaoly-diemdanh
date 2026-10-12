import { desc, eq, and } from "drizzle-orm";
import { attendance, sessions } from "../schema";
import type { Db } from "../types";

/** Các dòng điểm danh buổi HỌC của một em trong học kỳ (không tính buổi huỷ, buổi đi lễ), mới nhất trước. Không chọn cột nào của `students`. */
export function studentTermRecords(db: Db, studentId: string, termId: string) {
  return db
    .select({ sessionId: sessions.id, heldOn: sessions.heldOn, status: attendance.status, reason: attendance.reason })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(and(eq(attendance.studentId, studentId), eq(sessions.termId, termId), eq(sessions.kind, "class"), eq(sessions.cancelled, false)))
    .orderBy(desc(sessions.heldOn));
}
