import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { attentionList, classStats, gradeOverview } from "./stats";

type Status = "present" | "absent_excused" | "absent_unexcused" | "late";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const session = async (heldOn: string, extra: { cancelled?: boolean; classId?: string } = {}) =>
    (await db.insert(sessions).values({ classId: extra.classId ?? b.classId, termId: b.termId, heldOn, cancelled: extra.cancelled ?? false }).returning())[0];
  const mark = (sessionId: string, studentId: string, status: Status) => db.insert(attendance).values({ sessionId, studentId, status });
  return { db, b, kid, session, mark };
}

describe("classStats", () => {
  it("summarises each active student for the term and flags warnings", async () => {
    const { db, b, kid, session, mark } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    const [s1, s2, s3] = [await session("2026-10-04"), await session("2026-10-11"), await session("2026-10-18")];
    await mark(s1.id, an.id, "absent_unexcused"); await mark(s2.id, an.id, "absent_unexcused"); await mark(s3.id, an.id, "present");
    await mark(s1.id, binh.id, "absent_excused"); await mark(s2.id, binh.id, "late");
    const stats = await classStats(db, b.glv, b.classId, b.termId);
    const an1 = stats!.rows.find((r) => r.studentId === an.id)!;
    expect(an1.summary).toMatchObject({ present: 1, unexcused: 2, marked: 3 });
    expect(an1.summary.warning.level).toBe("warning");
    expect(stats!.rows.find((r) => r.studentId === binh.id)!.summary.warning.level).toBe("none");
    expect(stats!.className).toBe("Lớp A");
  });

  it("ignores cancelled sessions and hidden students", async () => {
    const { db, b, kid, session, mark } = await setup();
    const an = await kid("An");
    const hidden = await kid("Ẩn", { active: false });
    const s1 = await session("2026-10-04", { cancelled: true });
    await mark(s1.id, an.id, "absent_unexcused"); await mark(s1.id, hidden.id, "absent_unexcused");
    const stats = await classStats(db, b.glv, b.classId, b.termId);
    expect(stats!.rows.map((r) => r.studentId)).toEqual([an.id]);
    expect(stats!.rows[0].summary.unexcused).toBe(0);
  });

  it("is readable by the grade head, null for outsiders and unknown terms", async () => {
    const { db, b } = await setup();
    expect(await classStats(db, b.head, b.classId, b.termId)).not.toBeNull();
    expect(await classStats(db, b.otherGlv, b.classId, b.termId)).toBeNull();
    expect(await classStats(db, b.glv, b.classId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await classStats(db, b.glv, b.classId, "bad")).toBeNull();
  });
});

describe("attentionList", () => {
  async function scenario() {
    const s = await setup();
    const { b, kid, session, mark } = s;
    const [an, binh, chi] = [await kid("An"), await kid("Bình"), await kid("Chi")];
    const other = await kid("Dũng", {}, b.otherClassId);
    const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
    const o1 = await session("2026-10-04", { classId: b.otherClassId });
    await mark(s1.id, an.id, "absent_unexcused");
    await mark(s1.id, binh.id, "absent_unexcused"); await mark(s2.id, binh.id, "absent_unexcused");
    await mark(s1.id, chi.id, "absent_excused");
    await mark(o1.id, other.id, "absent_unexcused");
    return { ...s, an, binh, chi, other };
  }

  it("lists watch and warning students, warnings first, never students without unexcused absences", async () => {
    const { db, b, an, binh } = await scenario();
    const list = await attentionList(db, b.glv, b.termId);
    expect(list.map((i) => [i.studentId, i.level])).toEqual([[binh.id, "warning"], [an.id, "watch"]]);
  });

  it("only shows classes the user can read; the head sees the whole grade", async () => {
    const { db, b, other } = await scenario();
    expect((await attentionList(db, b.glv, b.termId)).some((i) => i.studentId === other.id)).toBe(false);
    expect((await attentionList(db, b.otherGlv, b.termId)).map((i) => i.studentId)).toEqual([other.id]);
    const head = await attentionList(db, b.head, b.termId);
    expect(head.map((i) => i.className)).toEqual(["Lớp A", "Lớp A"]);
  });
});

describe("gradeOverview", () => {
  it("is only for grade heads", async () => {
    const { db, b } = await setup();
    expect(await gradeOverview(db, b.glv, b.termId)).toBeNull();
  });

  it("reports students, sessions held, presence rate and warnings per class of the grade", async () => {
    const { db, b, kid, session, mark } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
    await session("2026-10-18", { cancelled: true });
    await mark(s1.id, an.id, "present"); await mark(s1.id, binh.id, "absent_unexcused");
    await mark(s2.id, an.id, "late"); await mark(s2.id, binh.id, "absent_unexcused");
    const rows = await gradeOverview(db, b.head, b.termId);
    expect(rows).toEqual([{ classId: b.classId, className: "Lớp A", studentCount: 2, sessions: 2, presentRate: 0.5, warningCount: 1 }]);
  });

  it("gives a null presence rate when nothing was marked", async () => {
    const { db, b } = await setup();
    expect((await gradeOverview(db, b.head, b.termId))![0].presentRate).toBeNull();
  });
  it("does not count sessions without any attendance row", async () => {
    const { db, b, kid, session, mark } = await setup();
    const an = await kid("An");
    const s1 = await session("2026-10-04");
    await session("2026-10-11");
    await mark(s1.id, an.id, "present");
    const rows = await gradeOverview(db, b.head, b.termId);
    expect(rows![0].sessions).toBe(1);
  });
});
