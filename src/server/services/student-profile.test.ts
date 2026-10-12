import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
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

  it("never carries the qr token", async () => {
    const { db, b, kid } = await setup();
    const p = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: kid.id, today: TODAY });
    expect(JSON.stringify(p)).not.toContain(kid.qrToken);
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
