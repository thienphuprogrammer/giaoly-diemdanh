import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

export function listStudents(db: Db, classId: string, includeInactive = false) {
  const where = includeInactive ? eq(students.classId, classId) : and(eq(students.classId, classId), eq(students.active, true));
  return db.select().from(students).where(where).orderBy(asc(students.fullName));
}

export async function getStudent(db: Db, id: string) {
  const [row] = await db.select().from(students).where(eq(students.id, id));
  return row ?? null;
}
