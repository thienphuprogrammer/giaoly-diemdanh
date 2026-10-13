import { classCatechists, classes, grades, schoolYears, terms, users } from "@/db/schema";
import type { Db } from "@/db/types";

export async function seedBasics(db: Db) {
  const [grade] = await db.insert(grades).values({ name: "Khối 1" }).returning();
  const [otherGrade] = await db.insert(grades).values({ name: "Khối 2" }).returning();
  const [year] = await db.insert(schoolYears).values({ name: "2026-2027" }).returning();
  const [term] = await db
    .insert(terms)
    .values({ schoolYearId: year.id, name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" })
    .returning();

  const mk = async (email: string, extra: Partial<typeof users.$inferInsert> = {}) =>
    (await db.insert(users).values({ email, name: email, passwordHash: "x", ...extra }).returning())[0];

  const head = await mk("head@x.vn", { isGradeHead: true, gradeId: grade.id });
  const glv = await mk("glv@x.vn", { gradeId: grade.id });
  const otherGlv = await mk("other@x.vn", { gradeId: otherGrade.id });

  const [cls] = await db.insert(classes).values({ gradeId: grade.id, schoolYearId: year.id, name: "Lớp A" }).returning();
  const [otherCls] = await db.insert(classes).values({ gradeId: otherGrade.id, schoolYearId: year.id, name: "Lớp B" }).returning();
  await db.insert(classCatechists).values([
    { classId: cls.id, userId: glv.id },
    { classId: otherCls.id, userId: otherGlv.id },
  ]);

  return {
    grade, otherGrade, year, term, head, glv, otherGlv, cls, otherCls,
    gradeId: grade.id, otherGradeId: otherGrade.id, yearId: year.id, termId: term.id,
    classId: cls.id, otherClassId: otherCls.id,
  };
}
export type Basics = Awaited<ReturnType<typeof seedBasics>>;
