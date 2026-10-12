import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { classes, grades, promotions, users, students } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

export interface PromotionClass {
  id: string;
  name: string;
  gradeId: string;
  gradeName: string;
  nextGradeId: string | null;
}

/** Lớp kèm khối và khối kế tiếp của khối đó; null khi không có. */
export async function getPromotionClass(db: Reader, classId: string): Promise<PromotionClass | null> {
  const [row] = await db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, gradeName: grades.name, nextGradeId: grades.nextGradeId })
    .from(classes)
    .innerJoin(grades, eq(grades.id, classes.gradeId))
    .where(eq(classes.id, classId));
  return row ?? null;
}

/** Các lớp của những khối cho trước, kèm số em đang học, theo tên lớp. */
export function classesOfGrades(db: Reader, gradeIds: string[]) {
  return db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, gradeName: grades.name, activeCount: count(students.id) })
    .from(classes)
    .innerJoin(grades, eq(grades.id, classes.gradeId))
    .leftJoin(students, and(eq(students.classId, classes.id), eq(students.active, true)))
    .where(inArray(classes.gradeId, gradeIds))
    .groupBy(classes.id, grades.name)
    .orderBy(asc(classes.name));
}

const toClass = alias(classes, "to_class");

/** Lượt lên lớp có lớp nguồn thuộc khối, mới nhất trước. `fresh` = còn trong 24 giờ (tính theo đồng hồ của database). */
export function listGradePromotions(db: Reader, gradeId: string, limit: number) {
  return db
    .select({
      id: promotions.id,
      fromClassName: classes.name,
      toClassName: toClass.name,
      studentIds: promotions.studentIds,
      createdAt: promotions.createdAt,
      undoneAt: promotions.undoneAt,
      actorName: users.name,
      fresh: sql<boolean>`${promotions.createdAt} > now() - interval '24 hours'`,
    })
    .from(promotions)
    .innerJoin(classes, eq(classes.id, promotions.fromClassId))
    .innerJoin(toClass, eq(toClass.id, promotions.toClassId))
    .leftJoin(users, eq(users.id, promotions.actorId))
    .where(eq(classes.gradeId, gradeId))
    .orderBy(desc(promotions.createdAt), desc(promotions.id))
    .limit(limit);
}

/** Một lượt lên lớp kèm khối của lớp nguồn và tên hai lớp (cho hoàn tác). */
export async function getPromotion(db: Reader, id: string) {
  const [row] = await db
    .select({
      id: promotions.id,
      fromClassId: promotions.fromClassId,
      toClassId: promotions.toClassId,
      fromGradeId: classes.gradeId,
      fromClassName: classes.name,
      toClassName: toClass.name,
      studentIds: promotions.studentIds,
      removedSeats: promotions.removedSeats,
      undoneAt: promotions.undoneAt,
      fresh: sql<boolean>`${promotions.createdAt} > now() - interval '24 hours'`,
    })
    .from(promotions)
    .innerJoin(classes, eq(classes.id, promotions.fromClassId))
    .innerJoin(toClass, eq(toClass.id, promotions.toClassId))
    .where(eq(promotions.id, id));
  return row ?? null;
}

export async function findPromotionByToken(db: Reader, actorId: string, clientToken: string) {
  const [row] = await db
    .select({ id: promotions.id, studentIds: promotions.studentIds, removedSeats: promotions.removedSeats, fromClassId: promotions.fromClassId, toClassId: promotions.toClassId })
    .from(promotions)
    .where(and(eq(promotions.actorId, actorId), eq(promotions.clientToken, clientToken)));
  return row ?? null;
}
