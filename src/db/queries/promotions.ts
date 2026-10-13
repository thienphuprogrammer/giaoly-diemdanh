import { and, arrayOverlaps, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditEvents, classes, grades, promotions, schoolYears, terms, users, students } from "../schema";
import type { Db } from "../types";

type Reader = Pick<Db, "select">;

export interface PromotionClass {
  id: string;
  name: string;
  gradeId: string;
  gradeName: string;
  nextGradeId: string | null;
  schoolYearId: string;
  schoolYearName: string;
  yearStartsOn: string | null;
}

/** Lớp kèm khối và khối kế tiếp của khối đó; null khi không có. */
export async function getPromotionClass(db: Reader, classId: string): Promise<PromotionClass | null> {
  const [row] = await db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, gradeName: grades.name, nextGradeId: grades.nextGradeId,
      schoolYearId: classes.schoolYearId, schoolYearName: schoolYears.name,
      yearStartsOn: sql<string | null>`(select min(${terms.startsOn})::text from ${terms} where ${terms.schoolYearId} = ${classes.schoolYearId})`,
    })
    .from(classes)
    .innerJoin(grades, eq(grades.id, classes.gradeId))
    .innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId))
    .where(eq(classes.id, classId));
  return row ?? null;
}

/** Các lớp của những khối cho trước, kèm số em đang học, theo tên lớp. */
export function classesWithCountsOfGrades(db: Reader, gradeIds?: string[]) {
  return db
    .select({ id: classes.id, name: classes.name, gradeId: classes.gradeId, gradeName: grades.name,
      schoolYearId: classes.schoolYearId, schoolYearName: schoolYears.name, activeCount: count(students.id) })
    .from(classes)
    .innerJoin(grades, eq(grades.id, classes.gradeId))
    .innerJoin(schoolYears, eq(schoolYears.id, classes.schoolYearId))
    .leftJoin(students, and(eq(students.classId, classes.id), eq(students.active, true)))
    .where(gradeIds ? inArray(classes.gradeId, gradeIds) : undefined)
    .groupBy(classes.id, grades.name, schoolYears.name)
    .orderBy(asc(classes.name), asc(schoolYears.name));
}

const toClass = alias(classes, "to_class");
const fromGrade = alias(grades, "from_grade");
const fromYear = alias(schoolYears, "from_year");
const toYear = alias(schoolYears, "to_year");

/**
 * Lượt lên lớp liên quan tới khối: lớp nguồn HOẶC lớp đích thuộc khối, mới nhất trước. `fresh` = còn trong 24 giờ
 * (đồng hồ của database). `days` giới hạn thêm theo số ngày gần đây (băng báo "chuyển vào").
 */
export function listGradePromotions(db: Reader, gradeId: string | undefined, limit: number, opts: { incomingOnly?: boolean; days?: number } = {}) {
  const scope = !gradeId ? undefined : opts.incomingOnly
    ? and(eq(toClass.gradeId, gradeId), ne(classes.gradeId, gradeId))
    : or(eq(classes.gradeId, gradeId), eq(toClass.gradeId, gradeId));
  return db
    .select({
      id: promotions.id,
      fromGradeId: classes.gradeId,
      fromGradeName: fromGrade.name,
      fromClassName: classes.name,
      toClassName: toClass.name,
      fromSchoolYearName: fromYear.name,
      toSchoolYearName: toYear.name,
      studentIds: promotions.studentIds,
      createdAt: promotions.createdAt,
      undoneAt: promotions.undoneAt,
      actorName: users.name,
      fresh: sql<boolean>`${promotions.createdAt} > now() - interval '24 hours'`,
    })
    .from(promotions)
    .innerJoin(classes, eq(classes.id, promotions.fromClassId))
    .innerJoin(fromGrade, eq(fromGrade.id, classes.gradeId))
    .innerJoin(toClass, eq(toClass.id, promotions.toClassId))
    .innerJoin(fromYear, eq(fromYear.id, classes.schoolYearId))
    .innerJoin(toYear, eq(toYear.id, toClass.schoolYearId))
    .leftJoin(users, eq(users.id, promotions.actorId))
    .where(and(scope, opts.days ? sql`${promotions.createdAt} > now() - make_interval(days => ${opts.days})` : undefined))
    .orderBy(desc(promotions.createdAt), desc(promotions.id))
    .limit(limit);
}

/** Dòng nhật ký "khối khác chọn khối này làm khối kế tiếp" (dòng ghi ở khối này về khối khác) trong `days` ngày gần đây. */
export function recentNextGradeEvents(db: Reader, gradeId: string, days: number) {
  return db
    .select({ id: auditEvents.id, at: auditEvents.at, action: auditEvents.action, summary: auditEvents.summary, actorName: users.name })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(
      eq(auditEvents.gradeId, gradeId),
      eq(auditEvents.action, "grade.next_grade"),
      ne(auditEvents.entityId, gradeId),
      sql`${auditEvents.at} > now() - make_interval(days => ${days})`,
    ))
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(10);
}

/** Có lượt lên lớp MỚI HƠN, chưa hoàn tác, gồm ít nhất một em của lượt này không. */
export async function hasLaterPromotion(db: Reader, promotionId: string, studentIds: string[]): Promise<boolean> {
  if (studentIds.length === 0) return false;
  const [row] = await db.select({ id: promotions.id }).from(promotions)
    .where(and(
      ne(promotions.id, promotionId),
      isNull(promotions.undoneAt),
      arrayOverlaps(promotions.studentIds, studentIds),
      gt(promotions.createdAt, sql`(select created_at from ${promotions} p where p.id = ${promotionId})`),
    ))
    .limit(1);
  return Boolean(row);
}

/** Một lượt lên lớp kèm khối của lớp nguồn và tên hai lớp (cho hoàn tác). */
export async function getPromotion(db: Reader, id: string) {
  const [row] = await db
    .select({
      id: promotions.id,
      fromClassId: promotions.fromClassId,
      toClassId: promotions.toClassId,
      fromGradeId: classes.gradeId,
      toGradeId: toClass.gradeId,
      fromClassName: classes.name,
      toClassName: toClass.name,
      studentIds: promotions.studentIds,
      removedSeats: promotions.removedSeats,
      newMembershipStudentIds: promotions.newMembershipStudentIds,
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
