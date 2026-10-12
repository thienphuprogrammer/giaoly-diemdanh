import { describe, expect, it } from "vitest";
import { attendance, sessions, students, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { getStudentProfile } from "./student-profile";
import { updateStudentContact } from "./students";

const TODAY = "2026-10-12";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An", saintName: "Phêrô", parentPhone: "0901234567", note: "Hay quên sách" }).returning();
  const session = async (heldOn: string) => (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn }).returning())[0];
  return { db, b, kid, session };
}

describe("getStudentProfile", () => {
  it("returns the student, term counts, attendance rate and records for a catechist", async () => {
    const { db, b, kid, session } = await setup();
    const [s1, s2, s3, s4] = [await session("2026-10-04"), await session("2026-10-11"), await session("2026-10-18"), await session("2026-10-25")];
    await db.insert(attendance).values([
      { sessionId: s1.id, studentId: kid.id, status: "present" },
      { sessionId: s2.id, studentId: kid.id, status: "late" },
      { sessionId: s3.id, studentId: kid.id, status: "absent_excused", reason: "Ốm" },
      { sessionId: s4.id, studentId: kid.id, status: "absent_unexcused" },
    ]);
    const p = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(p).not.toBeNull();
    expect(p!.canWrite).toBe(true);
    expect(p!.student).toMatchObject({ id: kid.id, fullName: "An", parentPhone: "0901234567", note: "Hay quên sách" });
    expect(p!.term?.name).toBe("Học kỳ 1");
    expect(p!.summary).toMatchObject({ present: 1, late: 1, excused: 1, unexcused: 1, marked: 4 });
    expect(p!.rate).toBeCloseTo(0.5);
    expect(p!.records.map((r) => r.heldOn)).toEqual(["2026-10-25", "2026-10-18", "2026-10-11", "2026-10-04"]);
  });

  it("has a null rate and no records when nothing is marked", async () => {
    const { db, b, kid } = await setup();
    const p = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(p!.rate).toBeNull();
    expect(p!.records).toEqual([]);
  });

  it("is read-only for a grade head who is not assigned", async () => {
    const { db, b, kid } = await setup();
    const p = await getStudentProfile(db, b.head, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(p!.canWrite).toBe(false);
  });

  it("answers null the same way for outsiders, unknown students and a mismatched class", async () => {
    const { db, b, kid } = await setup();
    expect(await getStudentProfile(db, b.otherGlv, { classId: b.classId, studentId: kid.id, today: TODAY })).toBeNull();
    expect(await getStudentProfile(db, b.glv, { classId: b.classId, studentId: "00000000-0000-4000-8000-000000000000", today: TODAY })).toBeNull();
    expect(await getStudentProfile(db, b.glv, { classId: b.classId, studentId: "not-a-uuid", today: TODAY })).toBeNull();
    expect(await getStudentProfile(db, b.otherGlv, { classId: b.otherClassId, studentId: kid.id, today: TODAY })).toBeNull();
  });

  it("is null for a grade head of another grade", async () => {
    const { db, b, kid } = await setup();
    const [otherHead] = await db.insert(users).values({ email: "head2@x.vn", name: "h2", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning();
    expect(await getStudentProfile(db, otherHead, { classId: b.classId, studentId: kid.id, today: TODAY })).toBeNull();
  });

  it("never carries the qr token", async () => {
    const { db, b, kid } = await setup();
    const p = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(JSON.stringify(p)).not.toContain(kid.qrToken);
  });
});

describe("getStudentProfile: Đi lễ block (spec §1b)", () => {
  const mass = async (db: Awaited<ReturnType<typeof setup>>["db"], classId: string, termId: string, heldOn: string, cancelled = false) =>
    (await db.insert(sessions).values({ classId, termId, heldOn, kind: "mass", cancelled }).returning())[0];

  it("counts this term's recorded weeks (newest first) with attended/missed, and warns at the grade threshold", async () => {
    const { db, b, kid, session } = await setup();
    const enrolled = await session("2026-09-12");
    await db.insert(attendance).values({ sessionId: enrolled.id, studentId: kid.id, status: "present" });
    const [w1, w2, w3] = [await mass(db, b.classId, b.termId, "2026-10-04"), await mass(db, b.classId, b.termId, "2026-10-11"), await mass(db, b.classId, b.termId, "2026-10-18")];
    const cancelled = await mass(db, b.classId, b.termId, "2026-10-25", true);
    await db.insert(attendance).values([
      { sessionId: w1.id, studentId: kid.id, status: "present" },
      { sessionId: w2.id, studentId: kid.id, status: "absent_unexcused" },
      { sessionId: cancelled.id, studentId: kid.id, status: "absent_unexcused" },
    ]);
    const [other] = await db.insert(students).values({ classId: b.classId, fullName: "Bạn" }).returning();
    await db.insert(attendance).values({ sessionId: w3.id, studentId: other.id, status: "present" }); // tuần 18/10 đã ghi; An không có dòng
    const p = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(p!.mass).toEqual({
      threshold: 2, counted: 3, attended: 1, missed: 2, warning: true,
      weeks: [
        { sessionId: w3.id, heldOn: "2026-10-18", attended: false },
        { sessionId: w2.id, heldOn: "2026-10-11", attended: false },
        { sessionId: w1.id, heldOn: "2026-10-04", attended: true },
      ],
    });
    // Mass rows never leak into the class block.
    expect(p!.summary.marked).toBe(1);
    expect(p!.records.map((r) => r.heldOn)).toEqual(["2026-09-12"]);
  });

  it("threshold - 1 missed weeks is not a warning; a never-recorded student has an empty block", async () => {
    const { db, b, kid, session } = await setup();
    const w1 = await mass(db, b.classId, b.termId, "2026-10-04");
    const [other] = await db.insert(students).values({ classId: b.classId, fullName: "Bạn" }).returning();
    await db.insert(attendance).values({ sessionId: w1.id, studentId: other.id, status: "present" });
    const never = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(never!.mass).toEqual({ threshold: 2, counted: 0, attended: 0, missed: 0, warning: false, weeks: [] });
    const enrolled = await session("2026-09-12");
    await db.insert(attendance).values({ sessionId: enrolled.id, studentId: kid.id, status: "present" });
    const one = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(one!.mass).toMatchObject({ missed: 1, warning: false });
  });
});

describe("updateStudentContact", () => {
  it("updates note and normalises the phone for the assigned catechist only", async () => {
    const { db, b, kid } = await setup();
    const r = await updateStudentContact(db, b.glv, { studentId: kid.id, parentPhone: "+84 912 345 678", note: "  Dị ứng đậu  " });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ parentPhone: "0912345678", note: "Dị ứng đậu", fullName: "An", saintName: "Phêrô" });
  });

  it("clears blank fields to null", async () => {
    const { db, b, kid } = await setup();
    await updateStudentContact(db, b.glv, { studentId: kid.id, parentPhone: "", note: "" });
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ parentPhone: null, note: null });
  });

  it("rejects an invalid phone without changing the row", async () => {
    const { db, b, kid } = await setup();
    const r = await updateStudentContact(db, b.glv, { studentId: kid.id, parentPhone: "123", note: "x" });
    expect(r).toEqual({ ok: false, error: "SĐT không hợp lệ" });
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ parentPhone: "0901234567", note: "Hay quên sách" });
  });

  it("is refused for a read-only grade head and for another class's catechist", async () => {
    const { db, b, kid } = await setup();
    for (const u of [b.head, b.otherGlv]) {
      const r = await updateStudentContact(db, u, { studentId: kid.id, parentPhone: "0987654321", note: "hack" });
      expect(r.ok).toBe(false);
    }
    const [row] = await db.select().from(students);
    expect(row.note).toBe("Hay quên sách");
  });

  it("rejects a note over 500 characters", async () => {
    const { db, b, kid } = await setup();
    expect((await updateStudentContact(db, b.glv, { studentId: kid.id, parentPhone: "", note: "x".repeat(501) })).ok).toBe(false);
  });
});
