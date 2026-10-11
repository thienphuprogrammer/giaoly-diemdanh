import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { findScanTarget, updateMarkIfUnchanged } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const key = { sessionId: session.id, studentId: an.id };
  const ctx = { sessionId: session.id, classId: b.classId };
  const row = async () => (await db.select().from(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, an.id))))[0];
  const values = (eventId: string) => ({ status: "present" as const, reason: null, updatedBy: b.glv.id, updatedAt: new Date(), lastEventId: eventId });
  return { db, b, an, key, ctx, row, values };
}

describe("updateMarkIfUnchanged (compare-and-set for scans)", () => {
  it("writes when the row still matches what was observed", async () => {
    const { db, an, key, ctx, row, values } = await setup();
    await db.insert(attendance).values({ ...key, status: "absent_unexcused", reason: "ốm" });
    const seen = await findScanTarget(db, ctx, { studentId: an.id });
    const eventId = crypto.randomUUID();
    expect(await updateMarkIfUnchanged(db, key, seen!, values(eventId))).toBe(true);
    expect(await row()).toMatchObject({ status: "present", lastEventId: eventId });
  });

  it("refuses when only the reason changed after it was observed", async () => {
    const { db, an, key, ctx, row, values } = await setup();
    await db.insert(attendance).values({ ...key, status: "absent_unexcused", reason: "ốm" });
    const seen = await findScanTarget(db, ctx, { studentId: an.id });
    await db.update(attendance).set({ reason: "về quê" }).where(and(eq(attendance.sessionId, key.sessionId), eq(attendance.studentId, key.studentId)));
    expect(await updateMarkIfUnchanged(db, key, seen!, values(crypto.randomUUID()))).toBe(false);
    expect(await row()).toMatchObject({ status: "absent_unexcused", reason: "về quê" });
  });

  it("refuses when a null reason became non-null, and when the last event changed", async () => {
    const { db, an, key, ctx, row, values } = await setup();
    await db.insert(attendance).values({ ...key, status: "absent_excused", reason: null });
    const seen = await findScanTarget(db, ctx, { studentId: an.id });
    const where = and(eq(attendance.sessionId, key.sessionId), eq(attendance.studentId, key.studentId));
    await db.update(attendance).set({ reason: "ốm" }).where(where);
    expect(await updateMarkIfUnchanged(db, key, seen!, values(crypto.randomUUID()))).toBe(false);
    await db.update(attendance).set({ reason: null, lastEventId: crypto.randomUUID() }).where(where);
    expect(await updateMarkIfUnchanged(db, key, seen!, values(crypto.randomUUID()))).toBe(false);
    expect((await row()).status).toBe("absent_excused");
  });
});
