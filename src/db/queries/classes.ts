import { and, count, eq, inArray, or } from "drizzle-orm";
import type { AppUser } from "@/lib/access/can-access";
import { classCatechists, classes, students } from "../schema";
import type { Db } from "../types";

const assignedTo = (db: Db, userId: string) =>
  db.select({ id: classCatechists.classId }).from(classCatechists).where(eq(classCatechists.userId, userId));

export async function listClassesForUser(db: Db, user: AppUser) {
  const visible =
    user.isGradeHead && user.gradeId
      ? or(inArray(classes.id, assignedTo(db, user.id)), eq(classes.gradeId, user.gradeId))
      : inArray(classes.id, assignedTo(db, user.id));
  const rows = await db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, studentCount: count(students.id) })
    .from(classes)
    .leftJoin(students, and(eq(students.classId, classes.id), eq(students.active, true)))
    .where(visible)
    .groupBy(classes.id)
    .orderBy(classes.name);
  const mine = new Set((await assignedTo(db, user.id)).map((r) => r.id));
  return rows.map((r) => ({ ...r, canWrite: mine.has(r.id) }));
}

export async function getClassById(db: Db, id: string) {
  const [row] = await db.select({ id: classes.id, name: classes.name, gradeId: classes.gradeId }).from(classes).where(eq(classes.id, id));
  return row ?? null;
}
