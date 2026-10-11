import { describe, expect, it } from "vitest";
import { sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan, getScanResults, getScanRoster } from "./scan";

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

describe("getScanResults", () => {
  it("returns the stored result of known events and skips unknown ones", async () => {
    const { db, b, mk } = await setup();
    const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const s = await mk("2026-10-11");
    const eventId = crypto.randomUUID();
    await applyScan(db, b.glv, { eventId, sessionId: s.id, kind: "scan", token: an.qrToken, mode: "present" });
    const r = await getScanResults(db, b.glv, { sessionId: s.id, eventIds: [eventId, crypto.randomUUID()] });
    expect(r).toEqual({ ok: true, data: { results: [{ eventId, kind: "scan", result: "applied", studentId: an.id, status: "present" }] } });
  });

  it("is forbidden for non-writers and rejects more than 50 ids", async () => {
    const { db, b, mk } = await setup();
    const s = await mk("2026-10-11");
    expect(await getScanResults(db, b.head, { sessionId: s.id, eventIds: [] })).toMatchObject({ ok: false, code: "forbidden" });
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(await getScanResults(db, b.glv, { sessionId: s.id, eventIds: many })).toMatchObject({ ok: false, code: "bad_request" });
  });
});
