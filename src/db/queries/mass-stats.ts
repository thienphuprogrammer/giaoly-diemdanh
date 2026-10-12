import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { attendance, sessions, students } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

/** Đi lễ không có "đi muộn"; một dòng `late` cũ (nếu có) vẫn là đã đi lễ. */
const ATTENDED = ["present", "late"] as const;

/**
 * Số tuần KHÔNG ĐI LỄ của từng em trong học kỳ (spec §1b) — định nghĩa duy nhất, dùng chung cho bảng tra máy quét
 * đi lễ và cảnh báo đi lễ (Task 31):
 * - một tuần "đã ghi nhận" = buổi `mass` của lớp trong học kỳ, KHÔNG bị huỷ, và có ít nhất một dòng điểm danh
 *   (bất kỳ em nào, bất kỳ trạng thái nào). Tuần chưa mở, mở mà chưa ghi gì, hoặc "không có lễ" thì không tính;
 * - em "không đi lễ" một tuần đã ghi nhận khi em không có dòng `present` trong buổi đó (dòng vắng có/không phép
 *   hoặc không có dòng nào đều tính).
 * `excludeSessionId`: bỏ một buổi khỏi phép đếm (buổi đang quét: "trước đó"). Trả về Map cho mọi em đang hoạt động
 * của lớp (em không bỏ tuần nào => 0). Một truy vấn.
 */
export async function missedMassWeeks(
  db: Reader, { classId, termId, excludeSessionId }: { classId: string; termId: string; excludeSessionId?: string },
): Promise<Map<string, number>> {
  const recorded = db.select({ id: sessions.id }).from(sessions).where(and(
    eq(sessions.classId, classId),
    eq(sessions.termId, termId),
    eq(sessions.kind, "mass"),
    eq(sessions.cancelled, false),
    excludeSessionId ? ne(sessions.id, excludeSessionId) : undefined,
    sql`exists (select 1 from ${attendance} where ${attendance.sessionId} = ${sessions.id})`,
  ));
  const rows = await db
    .select({
      studentId: students.id,
      n: sql<number>`((select count(*) from (${recorded}) as recorded_weeks) - count(${attendance.studentId}))::int`,
    })
    .from(students)
    .leftJoin(attendance, and(
      eq(attendance.studentId, students.id),
      inArray(attendance.sessionId, recorded),
      inArray(attendance.status, [...ATTENDED]),
    ))
    .where(and(eq(students.classId, classId), eq(students.active, true)))
    .groupBy(students.id);
  return new Map(rows.map((r) => [r.studentId, Number(r.n)]));
}
