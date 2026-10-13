import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppUser } from "@/lib/access/can-access";
import { todayInVietnam } from "@/lib/dates";
import { classCatechists, classMemberships, classes, schoolYears, students, terms } from "../schema";
import type { Db } from "../types";

const assignedTo = (db: Db, userId: string) =>
  db.select({ id: classCatechists.classId }).from(classCatechists).where(eq(classCatechists.userId, userId));

export async function listClassesForUser(db: Db, user: AppUser, schoolYearId?: string, today: string = todayInVietnam()) {
  if (schoolYearId !== undefined && !z.uuid().safeParse(schoolYearId).success) return [];
  const visible =
    user.isAdmin ? undefined : user.isGradeHead && user.gradeId
      ? or(inArray(classes.id, assignedTo(db, user.id)), eq(classes.gradeId, user.gradeId))
      : inArray(classes.id, assignedTo(db, user.id));
  const rows = await db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, schoolYearId: classes.schoolYearId, schoolYearName: schoolYears.name, studentCount: count(students.id) })
    .from(classes)
    .innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId))
    .leftJoin(classMemberships, eq(classMemberships.classId, classes.id))
    .leftJoin(students, and(eq(students.id, classMemberships.studentId), or(
      and(eq(students.classId, classes.id), eq(students.active, true)),
      and(ne(students.classId, classes.id), sql`(select max(${terms.endsOn}) from ${terms} where ${terms.schoolYearId} = ${classes.schoolYearId}) < ${today}::date`),
    )))
    .where(and(visible, schoolYearId ? eq(classes.schoolYearId, schoolYearId) : undefined))
    .groupBy(classes.id, schoolYears.name)
    .orderBy(classes.name, schoolYears.name);
  const mine = new Set((await assignedTo(db, user.id)).map((r) => r.id));
  return rows.map((r) => ({ ...r, yearId: r.schoolYearId, yearName: r.schoolYearName, canWrite: user.isAdmin || mine.has(r.id) }));
}

export async function getClassById(db: Db, id: string) {
  const [row] = await db.select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, schoolYearId: classes.schoolYearId, schoolYearName: schoolYears.name })
    .from(classes).innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId)).where(eq(classes.id, id));
  return row ? { ...row, yearId: row.schoolYearId, yearName: row.schoolYearName } : null;
}
