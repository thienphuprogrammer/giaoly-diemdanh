import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan, applyUndo } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const scan = async (extra: Record<string, unknown> = {}) => {
    const eventId = crypto.randomUUID();
    const r = await applyScan(db, b.glv, { eventId, sessionId: session.id, kind: "scan", token: an.qrToken, mode: "present", ...extra });
    return { eventId, r };
  };
  const undo = (targetEventId: string, extra: Record<string, unknown> = {}, user = b.glv) =>
    applyUndo(db, user, { eventId: crypto.randomUUID(), sessionId: session.id, targetEventId, ...extra });
  const row = async () => (await db.select().from(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, an.id))))[0];
  return { db, b, session, an, scan, undo, row };
}

describe("applyUndo", () => {
  it("undoing a scan of an unmarked student deletes the row (never makes them absent)", async () => {
    const { scan, undo, row } = await setup();
    const { eventId } = await scan();
    const r = await undo(eventId);
    expect(r).toMatchObject({ ok: true, data: { targetEventId: eventId, status: null } });
    expect(await row()).toBeUndefined();
  });

  it("undoing a confirmed change restores the previous status and reason", async () => {
    const { db, b, session, an, scan, undo, row } = await setup();
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "absent_excused", reason: "ốm" });
    const { eventId } = await scan({ confirmStatus: "present" });
    expect((await row()).status).toBe("present");
    expect((await undo(eventId)).ok).toBe(true);
    expect(await row()).toMatchObject({ status: "absent_excused", reason: "ốm", lastEventId: null });
  });

  it("refuses (conflict) when a newer manual edit exists and leaves it untouched", async () => {
    const { db, b, session, an, scan, undo, row } = await setup();
    const { eventId } = await scan();
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "late", reason: null });
    expect(await undo(eventId)).toMatchObject({ ok: false, code: "conflict" });
    expect((await row()).status).toBe("late");
  });

  it("a second undo of the same scan is a conflict, an undo retry with the same id returns the stored result", async () => {
    const { scan, undo } = await setup();
    const { eventId } = await scan();
    const eventIdOfUndo = crypto.randomUUID();
    const first = await undo(eventId, { eventId: eventIdOfUndo });
    const retry = await undo(eventId, { eventId: eventIdOfUndo });
    expect(retry).toEqual(first);
    expect(await undo(eventId)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("any catechist of the class can undo; the read-only head and other classes cannot", async () => {
    const { b, scan, undo, row } = await setup();
    const { eventId } = await scan();
    expect(await undo(eventId, {}, b.head)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await undo(eventId, {}, b.otherGlv)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await row()).status).toBe("present");
  });

  it("cannot undo an event of another session, a no-op, or an unknown event", async () => {
    const { db, b, scan, undo } = await setup();
    const { eventId } = await scan();
    const noop = await scan();
    const [other] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-04" }).returning();
    expect(await undo(eventId, { sessionId: other.id })).toMatchObject({ ok: false, code: "conflict" });
    expect(await undo(noop.eventId)).toMatchObject({ ok: false, code: "conflict" });
    expect(await undo(crypto.randomUUID())).toMatchObject({ ok: false, code: "conflict" });
    expect((await db.select().from(attendanceScans)).filter((l) => l.kind === "undo")).toHaveLength(0);
  });
});
