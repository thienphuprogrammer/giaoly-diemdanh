import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { studentTermRecords } from "./student-profile";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const [other] = await db.insert(students).values({ classId: b.classId, fullName: "Bình" }).returning();
  const session = async (heldOn: string, cancelled = false) =>
    (await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, cancelled }).returning())[0];
  return { db, b, kid, other, session };
}

describe("studentTermRecords", () => {
  it("lists the student's marks newest first with status and reason", async () => {
    const { db, b, kid, other, session } = await setup();
    const [s1, s2] = [await session("2026-10-04"), await session("2026-10-11")];
    await db.insert(attendance).values([
      { sessionId: s1.id, studentId: kid.id, status: "absent_excused", reason: "Ốm" },
      { sessionId: s2.id, studentId: kid.id, status: "present" },
      { sessionId: s2.id, studentId: other.id, status: "late" },
    ]);
    const rows = await studentTermRecords(db, kid.id, b.termId);
    expect(rows).toEqual([
      { sessionId: s2.id, heldOn: "2026-10-11", status: "present", reason: null },
      { sessionId: s1.id, heldOn: "2026-10-04", status: "absent_excused", reason: "Ốm" },
    ]);
  });

  it("skips cancelled sessions and sessions of other terms", async () => {
    const { db, b, kid, session } = await setup();
    const cancelled = await session("2026-10-04", true);
    await db.insert(attendance).values({ sessionId: cancelled.id, studentId: kid.id, status: "absent_unexcused" });
    expect(await studentTermRecords(db, kid.id, b.termId)).toEqual([]);
    expect(await studentTermRecords(db, kid.id, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("never selects the QR token", async () => {
    const { db, b, kid, session } = await setup();
    const s = await session("2026-10-04");
    await db.insert(attendance).values({ sessionId: s.id, studentId: kid.id, status: "present" });
    expect(JSON.stringify(await studentTermRecords(db, kid.id, b.termId))).not.toContain(kid.qrToken);
  });
});
