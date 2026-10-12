import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, grades, sessions, students, terms, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { getGradeSettings, setMassThreshold } from "./grade-settings";
import { massAttentionList, massStats } from "./mass-stats";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";
const TODAY = "2026-10-20";

/**
 * Lớp A (khối 1, ngưỡng mặc định 2): buổi học 12/09 có dòng của An, Bình, Chi (đã vào lớp từ đầu kỳ); Dũng chưa từng có
 * dòng nào. Ba tuần đi lễ đã ghi 04/10, 11/10, 18/10:
 * - An đi cả ba (0 tuần vắng lễ); Bình vắng 04/10 (KP) và 11/10 (không có dòng) => 2 = đúng ngưỡng => cảnh báo;
 * - Chi chỉ vắng 18/10 (có phép) => 1 = ngưỡng - 1 => không cảnh báo; Dũng chưa từng được ghi => 0.
 */
async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  const [an, binh, chi, dung] = [await kid("An"), await kid("Bình", { parentPhone: "0901234567" }), await kid("Chi"), await kid("Dũng")];
  const session = async (heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, kind: "mass", ...extra }).returning())[0].id;
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  const enrolled = await session("2026-09-12", { kind: "class" });
  for (const s of [an, binh, chi]) await mark(enrolled, s.id, "present");
  const [w1, w2, w3] = [await session("2026-10-04"), await session("2026-10-11"), await session("2026-10-18")];
  await mark(w1, an.id, "present"); await mark(w2, an.id, "present"); await mark(w3, an.id, "present");
  await mark(w1, binh.id, "absent_unexcused"); await mark(w3, binh.id, "present");
  await mark(w1, chi.id, "present"); await mark(w2, chi.id, "late"); await mark(w3, chi.id, "absent_excused");
  return { db, b, an, binh, chi, dung, session, mark, w1, w2, w3 };
}

const brief = (rows: { fullName: string; recordedWeeksCounted: number; attendedWeeks: number; missedWeeks: number; warning: boolean }[]) =>
  Object.fromEntries(rows.map((r) => [r.fullName, [r.recordedWeeksCounted, r.attendedWeeks, r.missedWeeks, r.warning]]));

describe("massStats", () => {
  it("per student counted/attended/missed weeks and a warning at exactly the threshold (2), not threshold - 1", async () => {
    const { db, b, w1, w2, w3 } = await setup();
    const s = await massStats(db, b.glv, { classId: b.classId, termId: b.termId });
    expect(s).not.toBeNull();
    expect(s!.term).toEqual({ id: b.termId, name: "Học kỳ 1" });
    expect(s!.className).toBe("Lớp A");
    expect(s!.threshold).toBe(2);
    expect(s!.weeks).toEqual([{ sessionId: w1, heldOn: "2026-10-04" }, { sessionId: w2, heldOn: "2026-10-11" }, { sessionId: w3, heldOn: "2026-10-18" }]);
    expect(brief(s!.rows)).toEqual({
      An: [3, 3, 0, false], "Bình": [3, 1, 2, true], Chi: [3, 2, 1, false], "Dũng": [0, 0, 0, false],
    });
    expect(s!.rows.find((r) => r.fullName === "Bình")!.cells).toEqual(["missed", "missed", "attended"]);
    expect(s!.rows.find((r) => r.fullName === "Dũng")!.cells).toEqual(["not_counted", "not_counted", "not_counted"]);
    expect(s!.totals).toEqual({ recordedWeeks: 3, students: 4, warnings: 1, countedWeeks: 9, attendedWeeks: 6 });
  });

  it("uses the grade's custom threshold", async () => {
    const { db, b } = await setup();
    await db.update(grades).set({ massThreshold: 3 }).where(eq(grades.id, b.gradeId));
    const three = await massStats(db, b.glv, { classId: b.classId, termId: b.termId });
    expect(three!.threshold).toBe(3);
    expect(three!.totals.warnings).toBe(0);
    await db.update(grades).set({ massThreshold: 1 }).where(eq(grades.id, b.gradeId));
    const one = await massStats(db, b.glv, { classId: b.classId, termId: b.termId });
    expect(brief(one!.rows)).toMatchObject({ "Bình": [3, 1, 2, true], Chi: [3, 2, 1, true], An: [3, 3, 0, false] });
  });

  it("ignores cancelled weeks, opened-but-empty weeks and class sessions", async () => {
    const { db, b, session, mark, binh, chi } = await setup();
    await session("2026-10-25"); // mở nhưng rỗng
    const cancelled = await session("2026-11-01", { cancelled: true });
    await mark(cancelled, binh.id, "absent_unexcused");
    const cls = await session("2026-10-24", { kind: "class" });
    await mark(cls, chi.id, "absent_unexcused");
    const s = await massStats(db, b.glv, { classId: b.classId, termId: b.termId });
    expect(s!.weeks).toHaveLength(3);
    expect(brief(s!.rows)).toMatchObject({ "Bình": [3, 1, 2, true], Chi: [3, 2, 1, false] });
  });

  it("a mid-term joiner only counts weeks from their first row", async () => {
    const { db, b, dung, w2, mark } = await setup();
    await mark(w2, dung.id, "absent_unexcused"); // lần đầu Dũng xuất hiện là tuần 11/10
    const s = await massStats(db, b.glv, { classId: b.classId, termId: b.termId });
    expect(brief(s!.rows)["Dũng"]).toEqual([2, 0, 2, true]);
  });

  it("defaults to the term containing today", async () => {
    const { db, b } = await setup();
    const s = await massStats(db, b.glv, { classId: b.classId, today: TODAY });
    expect(s!.term.id).toBe(b.termId);
  });

  it("authz: same read rule as classStats (assigned catechist, own grade head); null otherwise", async () => {
    const { db, b } = await setup();
    expect(await massStats(db, b.head, { classId: b.classId, termId: b.termId })).not.toBeNull();
    expect(await massStats(db, b.otherGlv, { classId: b.classId, termId: b.termId })).toBeNull();
    const [otherHead] = await db.insert(users)
      .values({ email: "head2@x.vn", name: "head2", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning();
    expect(await massStats(db, otherHead, { classId: b.classId, termId: b.termId })).toBeNull();
    expect(await massStats(db, b.glv, { classId: "not-a-uuid", termId: b.termId })).toBeNull();
    expect(await massStats(db, b.glv, { classId: b.classId, termId: "not-a-uuid" })).toBeNull();
    expect(await massStats(db, b.glv, { classId: crypto.randomUUID(), termId: b.termId })).toBeNull();
  });

  it("another term has its own weeks", async () => {
    const { db, b } = await setup();
    const [term2] = await db.insert(terms).values({ schoolYearId: b.term.schoolYearId, name: "Học kỳ 2", startsOn: "2027-01-16", endsOn: "2027-05-31" }).returning();
    const s = await massStats(db, b.glv, { classId: b.classId, termId: term2.id });
    expect(s!.weeks).toEqual([]);
    expect(s!.totals.warnings).toBe(0);
  });
});

describe("massAttentionList", () => {
  it("lists only students at/over their grade's threshold, with the server-only parent phone", async () => {
    const { db, b, binh } = await setup();
    expect(await massAttentionList(db, b.glv, b.termId)).toEqual([
      { classId: b.classId, className: "Lớp A", studentId: binh.id, fullName: "Bình", missed: 2, threshold: 2, parentPhone: "0901234567" },
    ]);
    expect(await massAttentionList(db, b.head, b.termId)).toHaveLength(1);
    expect(await massAttentionList(db, b.otherGlv, b.termId)).toEqual([]);
    expect(await massAttentionList(db, b.glv, "not-a-uuid")).toEqual([]);
  });

  it("follows a lowered threshold and sorts by missed weeks then name", async () => {
    const { db, b } = await setup();
    await db.update(grades).set({ massThreshold: 1 }).where(eq(grades.id, b.gradeId));
    const list = await massAttentionList(db, b.glv, b.termId);
    expect(list.map((i) => [i.fullName, i.missed])).toEqual([["Bình", 2], ["Chi", 1]]);
  });
});

describe("setMassThreshold (grade head of THAT grade only)", () => {
  it("the grade head changes the threshold; result carries before/after for a future audit log; warnings follow", async () => {
    const { db, b } = await setup();
    const r = await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold: "3" });
    expect(r).toEqual({ ok: true, data: { gradeId: b.gradeId, before: 2, after: 3 } });
    expect(await getGradeSettings(db, b.head)).toEqual({ gradeId: b.gradeId, gradeName: "Khối 1", massThreshold: 3 });
    expect((await massStats(db, b.glv, { classId: b.classId, termId: b.termId }))!.totals.warnings).toBe(0);
  });

  it("validates an integer 1..20 server-side", async () => {
    const { db, b } = await setup();
    for (const threshold of ["0", "21", "2.5", "abc", "", -1, 0]) {
      const r = await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold });
      expect(r.ok, `threshold ${JSON.stringify(threshold)}`).toBe(false);
    }
    expect(await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold: 1 })).toMatchObject({ ok: true });
    expect(await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold: 20 })).toMatchObject({ ok: true, data: { before: 1, after: 20 } });
  });

  it("refuses another grade's head, a catechist, and an unknown grade", async () => {
    const { db, b } = await setup();
    const [otherHead] = await db.insert(users)
      .values({ email: "head2@x.vn", name: "head2", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning();
    const forbidden = { ok: false, error: "Bạn không có quyền thực hiện thao tác này" };
    expect(await setMassThreshold(db, otherHead, { gradeId: b.gradeId, threshold: 5 })).toEqual(forbidden);
    expect(await setMassThreshold(db, b.glv, { gradeId: b.gradeId, threshold: 5 })).toEqual(forbidden);
    expect(await setMassThreshold(db, b.head, { gradeId: crypto.randomUUID(), threshold: 5 })).toEqual(forbidden);
    expect(await setMassThreshold(db, b.head, { gradeId: "nope", threshold: 5 })).toEqual(forbidden);
    const [g] = await db.select().from(grades).where(eq(grades.id, b.gradeId));
    expect(g.massThreshold).toBe(2);
    expect(await getGradeSettings(db, b.glv)).toBeNull();
  });

  it("the database itself refuses a threshold below 1 (CHECK constraint)", async () => {
    const { db, b } = await setup();
    await expect(db.update(grades).set({ massThreshold: 0 }).where(eq(grades.id, b.gradeId))).rejects.toThrow();
  });
});
