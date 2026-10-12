import { describe, expect, it } from "vitest";
import { attendance, grades, sessions, students, terms } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { eq } from "drizzle-orm";
import { massGrid, missedMassWeeks } from "./mass-stats";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";

/** Buổi học 12/09 (trước mọi tuần đi lễ) có dòng của An, Bình, Chi, Dũng: cả bốn em đã "có mặt ở lớp" từ đầu kỳ. */
const ENROLLED_ON = "2026-09-12";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, classId = b.classId) => (await db.insert(students).values({ classId, fullName }).returning())[0];
  const [an, binh, chi, dung] = [await kid("An"), await kid("Bình"), await kid("Chi"), await kid("Dũng")];
  const session = async (heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, kind: "mass", ...extra }).returning())[0].id;
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  const enrolled = await session(ENROLLED_ON, { kind: "class" });
  for (const s of [an, binh, chi, dung]) await mark(enrolled, s.id, "present");
  const names = [an, binh, chi, dung];
  const byName = async (opts: { excludeSessionId?: string } = {}, list = names) => {
    const missed = await missedMassWeeks(db, { classId: b.classId, termId: b.termId, ...opts });
    return Object.fromEntries(list.map((s) => [s.fullName, missed.get(s.id) ?? 0]));
  };
  return { db, b, an, binh, chi, dung, kid, session, mark, byName };
}

describe("missedMassWeeks (spec §1b: recorded weeks the student did not attend)", () => {
  it("a recorded week = a non-cancelled Mass session with at least one row; no present row = missed (absent row or no row)", async () => {
    const { session, mark, byName, an, binh, chi } = await setup();
    const w1 = await session("2026-10-04");
    await mark(w1, an.id, "present");
    await mark(w1, binh.id, "absent_excused");
    await mark(w1, chi.id, "absent_unexcused");
    const w2 = await session("2026-10-11");
    await mark(w2, an.id, "present");
    expect(await byName()).toEqual({ An: 0, "Bình": 2, Chi: 2, "Dũng": 2 });
  });

  it("weeks never opened, opened but empty, and cancelled weeks do not count", async () => {
    const { session, mark, byName, an } = await setup();
    await session("2026-10-04"); // mở nhưng chưa ghi gì
    const cancelled = await session("2026-10-11", { cancelled: true });
    await mark(cancelled, an.id, "absent_unexcused");
    expect(await byName()).toEqual({ An: 0, "Bình": 0, Chi: 0, "Dũng": 0 });
  });

  it("an old 'late' row counts as attended (Mass has no late)", async () => {
    const { session, mark, byName, an } = await setup();
    const w = await session("2026-10-04");
    await mark(w, an.id, "late");
    expect(await byName()).toEqual({ An: 0, "Bình": 1, Chi: 1, "Dũng": 1 });
  });

  it("ignores class sessions, other classes, other terms, and the excluded (current) session", async () => {
    const { db, b, session, mark, byName, an, kid } = await setup();
    const cls = await session("2026-10-04", { kind: "class" });
    await mark(cls, an.id, "absent_unexcused");
    const stranger = await kid("Lạ", b.otherClassId);
    const other = await session("2026-10-04", { classId: b.otherClassId });
    await mark(other, stranger.id, "present");
    const [term2] = await db.insert(terms).values({ schoolYearId: b.term.schoolYearId, name: "Học kỳ 2", startsOn: "2027-01-16", endsOn: "2027-05-31" }).returning();
    const later = await session("2027-01-17", { termId: term2.id });
    await mark(later, an.id, "absent_unexcused");
    expect(await byName()).toEqual({ An: 0, "Bình": 0, Chi: 0, "Dũng": 0 });
    const current = await session("2026-10-11");
    await mark(current, an.id, "present");
    expect(await byName()).toEqual({ An: 0, "Bình": 1, Chi: 1, "Dũng": 1 });
    expect(await byName({ excludeSessionId: current })).toEqual({ An: 0, "Bình": 0, Chi: 0, "Dũng": 0 });
  });

  it("only active students of the class are listed", async () => {
    const { db, b, session, mark, an } = await setup();
    const [gone] = await db.insert(students).values({ classId: b.classId, fullName: "Nghỉ", active: false }).returning();
    const w = await session("2026-10-04");
    await mark(w, an.id, "present");
    const missed = await missedMassWeeks(db, { classId: b.classId, termId: b.termId });
    expect(missed.has(gone.id)).toBe(false);
    expect(missed.get(an.id)).toBe(0);
  });
});

describe("missedMassWeeks: mid-term joiner heuristic (count only weeks on/after the first attendance row in the class)", () => {
  async function threeWeeks() {
    const ctx = await setup();
    const { session, mark, an } = ctx;
    const w1 = await session("2026-10-04");
    const w2 = await session("2026-10-11");
    const w3 = await session("2026-10-18");
    for (const w of [w1, w2, w3]) await mark(w, an.id, "present");
    return { ...ctx, w1, w2, w3 };
  }

  it("joined mid-term (first row is a class session between w1 and w2) => w1 is not counted", async () => {
    const { db, b, session, mark, kid, byName } = await threeWeeks();
    const moi = await kid("Mới");
    const cls = await session("2026-10-10", { kind: "class" });
    await mark(cls, moi.id, "present");
    expect(await byName({}, [moi])).toEqual({ "Mới": 2 });
    const grid = await massGrid(db, { classIds: [b.classId], termId: b.termId });
    expect(grid.students.find((s) => s.id === moi.id)?.firstSeen).toBe("2026-10-10");
  });

  it("never recorded in the class at all => 0 weeks (no warning for a student never recorded)", async () => {
    const { kid, byName } = await threeWeeks();
    const ghost = await kid("Chưa ghi");
    expect(await byName({}, [ghost])).toEqual({ "Chưa ghi": 0 });
  });

  it("recorded only at Mass (first row is an absent row on w2) => counts w2 and w3", async () => {
    const { kid, mark, w2, byName } = await threeWeeks();
    const onlyMass = await kid("Chỉ lễ");
    await mark(w2, onlyMass.id, "absent_unexcused");
    expect(await byName({}, [onlyMass])).toEqual({ "Chỉ lễ": 2 });
  });

  it("recorded only in class (class row before every Mass week) => counts all weeks", async () => {
    const { byName, binh } = await threeWeeks();
    expect(await byName({}, [binh])).toEqual({ "Bình": 3 });
  });

  it("a first row in an earlier term counts as already enrolled", async () => {
    const { db, b, kid, mark, byName } = await threeWeeks();
    const [oldTerm] = await db.insert(terms).values({ schoolYearId: b.term.schoolYearId, name: "Học kỳ cũ", startsOn: "2026-01-05", endsOn: "2026-05-31" }).returning();
    const old = (await db.insert(sessions).values({ classId: b.classId, termId: oldTerm.id, heldOn: "2026-03-07" }).returning())[0].id;
    const veteran = await kid("Cũ");
    await mark(old, veteran.id, "absent_excused");
    expect(await byName({}, [veteran])).toEqual({ "Cũ": 3 });
  });

  it("rows in ANOTHER class do not count as first seen here (Task 36 move: counts restart in the new class)", async () => {
    const { db, b, kid, byName } = await threeWeeks();
    const moved = await kid("Chuyển");
    const otherSession = (await db.insert(sessions).values({ classId: b.otherClassId, termId: b.termId, heldOn: "2026-09-19" }).returning())[0].id;
    await db.insert(attendance).values({ sessionId: otherSession, studentId: moved.id, status: "present" });
    expect(await byName({}, [moved])).toEqual({ "Chuyển": 0 });
  });
});

describe("massGrid", () => {
  it("returns the recorded weeks per class (oldest first), each student's attended weeks, first-seen date and grade threshold", async () => {
    const { db, b, session, mark, an, binh } = await setup();
    await db.update(grades).set({ massThreshold: 3 }).where(eq(grades.id, b.gradeId));
    const w2 = await session("2026-10-11");
    const w1 = await session("2026-10-04");
    await mark(w1, an.id, "present");
    await mark(w2, an.id, "late");
    await mark(w2, binh.id, "absent_unexcused");
    const grid = await massGrid(db, { classIds: [b.classId], termId: b.termId });
    expect(grid.weeks.get(b.classId)).toEqual([{ sessionId: w1, heldOn: "2026-10-04" }, { sessionId: w2, heldOn: "2026-10-11" }]);
    const anRow = grid.students.find((s) => s.id === an.id)!;
    expect(anRow).toMatchObject({ classId: b.classId, fullName: "An", firstSeen: ENROLLED_ON, threshold: 3 });
    expect([...anRow.attended].sort()).toEqual([w1, w2].sort());
    expect(grid.students.find((s) => s.id === binh.id)!.attended.size).toBe(0);
    expect(grid.students.map((s) => s.fullName)).toEqual(["An", "Bình", "Chi", "Dũng"]);
  });

  it("can load one student even when inactive (profile), and returns nothing for no classes", async () => {
    const { db, b, session, mark, an } = await setup();
    await db.update(students).set({ active: false }).where(eq(students.id, an.id));
    const w = await session("2026-10-04");
    await mark(w, an.id, "present");
    const one = await massGrid(db, { classIds: [b.classId], termId: b.termId, studentId: an.id });
    expect(one.students.map((s) => s.id)).toEqual([an.id]);
    expect(await massGrid(db, { classIds: [], termId: b.termId })).toEqual({ weeks: new Map(), students: [] });
  });
});
