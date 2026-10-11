import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

/** Mọi truy vấn thiếu nhi dùng danh sách cột này; `qrToken` cố ý vắng mặt để không lọt xuống client. */
export const studentColumns = {
  id: students.id,
  classId: students.classId,
  saintName: students.saintName,
  fullName: students.fullName,
  birthDate: students.birthDate,
  parentPhone: students.parentPhone,
  note: students.note,
  active: students.active,
} as const;

export function listStudents(db: Db, classId: string, includeInactive = false) {
  const where = includeInactive ? eq(students.classId, classId) : and(eq(students.classId, classId), eq(students.active, true));
  return db.select(studentColumns).from(students).where(where).orderBy(asc(students.fullName));
}

export async function getStudent(db: Db, id: string) {
  const [row] = await db.select(studentColumns).from(students).where(eq(students.id, id));
  return row ?? null;
}
