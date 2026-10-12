import { describe, expect, it } from "vitest";
import { attendance, sessions, students, terms } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { missedMassWeeks } from "./mass-stats";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, classId = b.classId) => (await db.insert(students).values({ classId, fullName }).returning())[0];
  const [an, binh, chi, dung] = [await kid("An"), await kid("Bình"), await kid("Chi"), await kid("Dũng")];
  const session = async (heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, kind: "mass", ...extra }).returning())[0].id;
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  const byName = async (opts: { excludeSessionId?: string } = {}) => {
    const missed = await missedMassWeeks(db, { classId: b.classId, termId: b.termId, ...opts });
    return Object.fromEntries([an, binh, chi, dung].map((s) => [s.fullName, missed.get(s.id) ?? 0]));
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
