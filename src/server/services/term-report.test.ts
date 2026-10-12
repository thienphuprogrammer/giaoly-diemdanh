import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classes, attendance, sessions, students, users } from "@/db/schema";
import { buildReportRows } from "@/lib/report/term-report";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { classTermReport, gradeReport } from "./term-report";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";
const PHONE = "0901234567";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const session = async (heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, ...extra }).returning())[0];
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  const an = await kid("An", { parentPhone: PHONE, saintName: "Giuse" });
  const binh = await kid("Bình");
  const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
  await mark(s1.id, an.id, "present"); await mark(s2.id, an.id, "late");
  await mark(s1.id, binh.id, "absent_unexcused"); await mark(s2.id, binh.id, "absent_unexcused");
  const m1 = await session("2026-10-04", { kind: "mass" });
  const m2 = await session("2026-10-11", { kind: "mass" });
  await mark(m1.id, an.id, "present"); await mark(m2.id, an.id, "present");
  await mark(m1.id, binh.id, "absent_unexcused"); // tuần 2 không dòng => vắng lễ => 2 tuần = ngưỡng
  return { db, b, kid, session, mark, an, binh };
}

describe("classTermReport", () => {
  it("merges class stats and mass tallies per student, and exposes term dates and grade", async () => {
    const { db, b, an, binh } = await setup();
    const r = await classTermReport(db, b.glv, b.classId, b.termId);
    expect(r).not.toBeNull();
    expect(r!.className).toBe("Lớp A");
    expect(r!.gradeName).toBe("Khối 1");
    expect(r!.term).toEqual({ id: b.termId, name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" });
    expect(r!.massWeeks).toBe(2);
    const rows = buildReportRows(r!.rows);
    const byId = Object.fromEntries(r!.rows.map((x, i) => [x.studentId, rows[i]]));
    expect(byId[an.id]).toMatchObject({ present: 1, late: 1, percent: "100%", mass: "2/2", warning: "" });
    expect(byId[binh.id]).toMatchObject({ unexcused: 2, percent: "0%", mass: "0/2", warning: "Chú ý (≥2 vắng KP); Vắng lễ ≥ ngưỡng" });
  });

  it("is readable by the class catechist and the grade head, null for another grade's head/catechist and bad input", async () => {
    const { db, b } = await setup();
    expect(await classTermReport(db, b.glv, b.classId, b.termId)).not.toBeNull();
    expect(await classTermReport(db, b.head, b.classId, b.termId)).not.toBeNull();
    expect(await classTermReport(db, b.otherGlv, b.classId, b.termId)).toBeNull();
    const otherHead = (await db.insert(users).values({ email: "oh@x.vn", name: "OH", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning())[0];
    expect(await classTermReport(db, otherHead, b.classId, b.termId)).toBeNull();
    expect(await classTermReport(db, b.glv, "bad", b.termId)).toBeNull();
    expect(await classTermReport(db, b.glv, b.classId, "bad")).toBeNull();
    expect(await classTermReport(db, b.glv, b.classId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("past-term report keeps promoted and inactive students, labelled", async () => {
    const { db, b, kid, session, mark } = await setup();
    const up = await kid("Lên Lớp");
    const left = await kid("Đã Nghỉ", { active: false });
    const s = await session("2026-11-01");
    await mark(s.id, up.id, "present"); await mark(s.id, left.id, "absent_excused");
    const [next] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp B1" }).returning();
    await db.update(students).set({ classId: next.id }).where(eq(students.id, up.id));
    const r = await classTermReport(db, b.glv, b.classId, b.termId, "2027-02-01");
    const names = buildReportRows(r!.rows).map((x) => x.fullName);
    expect(names).toContain("Lên Lớp (đã lên lớp khác)");
    expect(names).toContain("Đã Nghỉ (đã nghỉ)");
    // học kỳ hiện tại thì em đã lên lớp biến mất khỏi lớp cũ
    const now = await classTermReport(db, b.glv, b.classId, b.termId, "2026-11-02");
    expect(now!.rows.map((x) => x.fullName)).not.toContain("Lên Lớp");
  });

  it("carries no phone number or qr token anywhere in the report data", async () => {
    const { db, b } = await setup();
    const r = await classTermReport(db, b.glv, b.classId, b.termId);
    const json = JSON.stringify({ r, rows: buildReportRows(r!.rows) });
    expect(json).not.toContain(PHONE);
    expect(json.toLowerCase()).not.toContain("qr");
    expect(json.toLowerCase()).not.toContain("phone");
    const tokens = await db.select({ t: students.qrToken }).from(students);
    for (const { t } of tokens) if (t) expect(json).not.toContain(t);
  });

  it("handles a class with no students", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const r = await classTermReport(db, b.glv, b.classId, b.termId);
    expect(r!.rows).toEqual([]);
    expect(r!.massWeeks).toBe(0);
  });
});

describe("gradeReport", () => {
  it("is head-only: catechist, other grade head and outsider get null", async () => {
    const { db, b } = await setup();
    expect(await gradeReport(db, b.glv, b.termId)).toBeNull();
    expect(await gradeReport(db, b.otherGlv, b.termId)).toBeNull();
    const otherHead = (await db.insert(users).values({ email: "oh@x.vn", name: "OH", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning())[0];
    const theirs = await gradeReport(db, otherHead, b.termId);
    expect(theirs!.classes.map((c) => c.className)).toEqual(["Lớp B"]);
    expect(await gradeReport(db, b.head, "bad")).toBeNull();
  });

  it("summarises each class and lists warned students without phones", async () => {
    const { db, b, binh } = await setup();
    const r = await gradeReport(db, b.head, b.termId);
    expect(r!.gradeName).toBe("Khối 1");
    expect(r!.classes).toEqual([{
      classId: b.classId, className: "Lớp A", studentCount: 2, sessions: 2, presentRate: 0.5, unexcusedWarnings: 1, massWarnings: 1, massWeeks: 2,
    }]);
    expect(r!.warnings).toEqual([{ studentId: binh.id, fullName: "Bình", className: "Lớp A", unexcused: 2, missedMass: 2 }]);
    expect(JSON.stringify(r)).not.toContain(PHONE);
    expect(JSON.stringify(r).toLowerCase()).not.toContain("phone");
  });

  it("does not list promoted students as warned", async () => {
    const { db, b, binh } = await setup();
    const [next] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp Z" }).returning();
    await db.update(students).set({ classId: next.id }).where(eq(students.id, binh.id));
    const r = await gradeReport(db, b.head, b.termId, "2027-02-01");
    expect(r!.warnings).toEqual([]);
  });
});
