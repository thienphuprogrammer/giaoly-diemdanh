import { asc, sql } from "drizzle-orm";
import { attendance, auditEvents, grades, seatAssignments, seatingPlans, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";

/** Các dòng nhật ký theo thứ tự ghi. */
export const auditRows = (db: Db) => db.select().from(auditEvents).orderBy(asc(auditEvents.at));

/** Làm mọi lần chèn nhật ký thất bại (trigger ném lỗi) để kiểm tra rollback "ghi xong thay đổi rồi mới hỏng". */
export async function breakAuditInserts(db: Db): Promise<void> {
  await db.execute(sql`create or replace function audit_fail() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$`);
  await db.execute(sql`create trigger audit_fail before insert on audit_events for each row execute function audit_fail()`);
}

/** Ảnh chụp mọi bảng dữ liệu mà các service có nhật ký thay đổi, để so trước/sau một lần rollback. */
export async function dataSnapshot(db: Db) {
  const order = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => JSON.stringify(r)).sort();
  return {
    attendance: order(await db.select().from(attendance)),
    sessions: order(await db.select().from(sessions)),
    students: order(await db.select().from(students)),
    plans: order(await db.select().from(seatingPlans)),
    seats: order(await db.select().from(seatAssignments)),
    grades: order(await db.select().from(grades)),
  };
}
