import { describe, expect, it } from "vitest";
import { sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { getScanRoster } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const mk = (heldOn: string) => db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn }).returning().then((r) => r[0]);
  return { db, b, mk };
}

describe("getScanRoster", () => {
  it("gives writers the active students with token, current mark and prior absences", async () => {
    const { db, b, mk } = await setup();
    const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An", saintName: "Phêrô" }).returning();
    await db.insert(students).values({ classId: b.classId, fullName: "Ẩn", active: false });
    const [s1, s2] = [await mk("2026-10-04"), await mk("2026-10-11")];
    await setStatus(db, b.glv, { sessionId: s1.id, studentId: an.id, status: "absent_unexcused", reason: null });
    await setStatus(db, b.glv, { sessionId: s2.id, studentId: an.id, status: "late", reason: null });
    const roster = await getScanRoster(db, b.glv, s2.id);
    expect(roster?.students).toEqual([
      { studentId: an.id, fullName: "An", saintName: "Phêrô", token: an.qrToken, status: "late", reason: null, priorUnexcused: 1 },
    ]);
  });

  it("is null for the read-only head, other classes and malformed ids", async () => {
    const { db, b, mk } = await setup();
    const s = await mk("2026-10-11");
    expect(await getScanRoster(db, b.head, s.id)).toBeNull();
    expect(await getScanRoster(db, b.otherGlv, s.id)).toBeNull();
    expect(await getScanRoster(db, b.glv, "nope")).toBeNull();
  });
});
