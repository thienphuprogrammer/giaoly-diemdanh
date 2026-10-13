import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, classCatechists, classes, sessions, students, terms } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { homeOverview } from "./home";

const TODAY = "2026-10-13";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  const session = async (heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, ...extra }).returning())[0];
  return { db, b, kid, session };
}

describe("homeOverview", () => {
  it("scopes catechists to assignments and heads to their grade plus cross-grade assignments, with write rights only on assignments", async () => {
    const { db, b, kid } = await setup();
    const [sameGrade] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp C" }).returning();
    await db.insert(classCatechists).values({ classId: b.otherClassId, userId: b.head.id });
    await kid("An");
    await kid("Bình", { classId: sameGrade.id });
    await kid("Chi", { classId: b.otherClassId });

    const catechist = await homeOverview(db, b.glv, TODAY);
    expect(catechist.classes.map((c) => [c.id, c.canWrite])).toEqual([[b.classId, true]]);
    expect(catechist.summary).toEqual({ classes: 1, students: 1, attention: 0 });

    const head = await homeOverview(db, b.head, TODAY);
    expect(head.classes.map((c) => [c.id, c.canWrite])).toEqual([
      [b.classId, false], [b.otherClassId, true], [sameGrade.id, false],
    ]);
    expect(head.summary).toEqual({ classes: 3, students: 3, attention: 0 });
    expect((await homeOverview(db, b.otherGlv, TODAY)).classes.map((c) => c.id)).toEqual([b.otherClassId]);
  });

  it("counts only today's class marks for the current active roster and returns the configured schedule", async () => {
    const { db, b, kid, session } = await setup();
    await db.update(classes).set({ meetsOn: 2, meetsAt: "08:30" }).where(eq(classes.id, b.classId));
    const [an, binh, inactive, moved] = [await kid("An"), await kid("Bình"), await kid("Đã nghỉ"), await kid("Đã chuyển")];
    const today = await session(TODAY);
    const yesterday = await session("2026-10-12");
    const mass = await session(TODAY, { kind: "mass" });
    await db.insert(attendance).values([
      { sessionId: today.id, studentId: an.id, status: "late" },
      { sessionId: today.id, studentId: inactive.id, status: "present" },
      { sessionId: today.id, studentId: moved.id, status: "present" },
      { sessionId: yesterday.id, studentId: binh.id, status: "present" },
      { sessionId: mass.id, studentId: binh.id, status: "present" },
    ]);
    await db.update(students).set({ active: false }).where(eq(students.id, inactive.id));
    await db.update(students).set({ classId: b.otherClassId }).where(eq(students.id, moved.id));

    const result = await homeOverview(db, b.glv, TODAY);
    expect(result.today).toBe(TODAY);
    expect(result.activeTerm).toEqual({ id: b.termId, name: "Học kỳ 1" });
    expect(result.classes[0]).toMatchObject({
      id: b.classId, studentCount: 2, meetsOn: 2, meetsAt: "08:30", scheduleLabel: "Thứ ba 08:30",
      session: { id: today.id, cancelled: false, marked: 1 },
    });
    expect(result.summary.students).toBe(2);
  });

  it("keeps cancelled, zero-roster, and unopened sessions distinct", async () => {
    const { db, b, kid, session } = await setup();
    await kid("An");
    const cancelled = await session(TODAY, { cancelled: true });
    const [empty, unopened] = await db.insert(classes).values([
      { gradeId: b.gradeId, name: "Lớp C" }, { gradeId: b.gradeId, name: "Lớp D" },
    ]).returning();
    const retired = await kid("Đã nghỉ", { classId: empty.id, active: false });
    const emptySession = await session(TODAY, { classId: empty.id });
    await db.insert(attendance).values({ sessionId: emptySession.id, studentId: retired.id, status: "present" });

    const result = await homeOverview(db, b.head, TODAY);
    expect(result.classes.find((c) => c.id === b.classId)?.session).toEqual({ id: cancelled.id, cancelled: true, marked: 0 });
    expect(result.classes.find((c) => c.id === empty.id)).toMatchObject({
      studentCount: 0, session: { id: emptySession.id, cancelled: false, marked: 0 },
    });
    expect(result.classes.find((c) => c.id === unopened.id)).toMatchObject({
      studentCount: 0, scheduleLabel: null, session: null,
    });
  });

  it("does not create a session or attendance when either a catechist or a read-only head opens the homepage", async () => {
    const { db, b, kid } = await setup();
    await kid("An");
    await db.update(classes).set({ meetsOn: 2, meetsAt: "08:30" }).where(eq(classes.id, b.classId));
    expect((await homeOverview(db, b.glv, TODAY)).classes[0].session).toBeNull();
    expect((await homeOverview(db, b.head, TODAY)).classes[0]).toMatchObject({ canWrite: false, session: null });
    expect(await db.select().from(sessions)).toEqual([]);
    expect(await db.select().from(attendance)).toEqual([]);
  });

  it("combines class and mass attention once per active child, prioritizes warnings, and strips phone and QR data", async () => {
    const { db, b, kid, session } = await setup();
    const [watch, both, massOnly, inactive, moved] = [
      await kid("An"), await kid("Bình", { parentPhone: "0901234567" }), await kid("Chi"),
      await kid("Đã nghỉ"), await kid("Đã chuyển"),
    ];
    const oldClasses = [await session("2026-09-20"), await session("2026-09-27")];
    const masses = [await session("2026-10-04", { kind: "mass" }), await session("2026-10-11", { kind: "mass" })];
    for (const [index, held] of oldClasses.entries()) {
      await db.insert(attendance).values([
        { sessionId: held.id, studentId: watch.id, status: index === 0 ? "absent_unexcused" : "present" },
        { sessionId: held.id, studentId: massOnly.id, status: "present" },
        ...[both, inactive, moved].map((s) => ({ sessionId: held.id, studentId: s.id, status: "absent_unexcused" as const })),
      ]);
    }
    for (const held of masses) {
      await db.insert(attendance).values([
        { sessionId: held.id, studentId: watch.id, status: "present" },
        ...[both, massOnly, inactive, moved].map((s) => ({ sessionId: held.id, studentId: s.id, status: "absent_unexcused" as const })),
      ]);
    }
    await db.update(students).set({ active: false }).where(eq(students.id, inactive.id));
    await db.update(students).set({ classId: b.otherClassId }).where(eq(students.id, moved.id));

    const result = await homeOverview(db, b.glv, TODAY);
    expect(result.attention).toEqual([
      { studentId: both.id, fullName: "Bình", classId: b.classId, className: "Lớp A", classAbsences: 2, massMissed: 2, warning: true },
      { studentId: massOnly.id, fullName: "Chi", classId: b.classId, className: "Lớp A", classAbsences: null, massMissed: 2, warning: true },
      { studentId: watch.id, fullName: "An", classId: b.classId, className: "Lớp A", classAbsences: 1, massMissed: null, warning: false },
    ]);
    expect(result.summary.attention).toBe(3);
    expect(JSON.stringify(result)).not.toContain("parentPhone");
    expect(JSON.stringify(result)).not.toContain("0901234567");
    expect(JSON.stringify(result)).not.toContain(both.qrToken);
  });

  it("separates an actually active term from the last started selected term and handles no terms", async () => {
    const { db, b, kid, session } = await setup();
    const an = await kid("An");
    const held = await session("2026-10-11");
    await db.insert(attendance).values({ sessionId: held.id, studentId: an.id, status: "absent_unexcused" });
    await db.insert(terms).values({
      schoolYearId: b.term.schoolYearId, name: "Học kỳ tương lai", startsOn: "2027-09-01", endsOn: "2028-01-15",
    });

    const betweenTerms = await homeOverview(db, b.glv, "2027-06-01");
    expect(betweenTerms.activeTerm).toBeNull();
    expect(betweenTerms.term).toEqual({ id: b.termId, name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" });
    expect(betweenTerms.attention.map((s) => s.studentId)).toEqual([an.id]);

    await db.delete(terms);
    const noTerms = await homeOverview(db, b.glv, TODAY);
    expect(noTerms).toMatchObject({ activeTerm: null, term: null, attention: [], summary: { classes: 1, students: 1, attention: 0 } });
  });
});
