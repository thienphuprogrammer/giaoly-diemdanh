import { and, asc, eq, ne, or } from "drizzle-orm";
import { classMemberships, students } from "../schema";
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

export async function listStudents(db: Db, classId: string, includeInactive = false) {
  const rows = await db.select(studentColumns).from(students)
    .innerJoin(classMemberships, eq(classMemberships.studentId, students.id))
    .where(and(eq(classMemberships.classId, classId), includeInactive ? undefined : or(eq(students.active, true), ne(students.classId, classId))))
    .orderBy(asc(students.fullName));
  return rows.map((s) => ({ ...s, former: s.classId !== classId }));
}

export async function wasStudentInClass(db: Db, studentId: string, classId: string): Promise<boolean> {
  const [row] = await db.select({ id: classMemberships.studentId }).from(classMemberships)
    .where(and(eq(classMemberships.studentId, studentId), eq(classMemberships.classId, classId))).limit(1);
  return !!row;
}

export async function getStudent(db: Db, id: string) {
  const [row] = await db.select(studentColumns).from(students).where(eq(students.id, id));
  return row ?? null;
}
