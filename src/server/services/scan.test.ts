import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, classCatechists, sessions, students, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setStatus } from "./attendance";
import { applyScan } from "./scan";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const eid = () => crypto.randomUUID();
  const scan = (user: typeof b.glv, token: string, extra: Record<string, unknown> = {}, sessionId = session.id) =>
    applyScan(db, user, { eventId: eid(), sessionId, kind: "scan", token, mode: "present", ...extra });
  const rows = (studentId: string) => db.select().from(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, studentId)));
  return { db, b, session, kid, eid, scan, rows };
}

describe("applyScan: recording", () => {
  it("records Có mặt for an unmarked student and links the row to the event", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const r = await scan(b.glv, an.qrToken, { eventId });
    expect(r).toEqual({ ok: true, data: { eventId, result: "applied", studentId: an.id, fullName: "An", saintName: null, status: "present" } });
    expect((await rows(an.id))[0]).toMatchObject({ status: "present", lastEventId: eventId, updatedBy: b.glv.id });
    const [log] = await db.select().from(attendanceScans);
    expect(log).toMatchObject({ eventId, kind: "scan", result: "applied", prevStatus: null, newStatus: "present", actorId: b.glv.id, mode: "present" });
  });

  it("late mode records Đi muộn", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const r = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(r.ok && r.data.status).toBe("late");
    expect((await rows(an.id))[0].status).toBe("late");
  });

  it("scanning an already-present student changes nothing", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    await scan(b.glv, an.qrToken);
    const again = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(again.ok && again.data).toMatchObject({ result: "noop", reason: "already_present", status: "present" });
    expect((await rows(an.id))[0].status).toBe("present");
    expect((await db.select().from(attendanceScans)).filter((l) => l.result === "noop")).toHaveLength(1);
  });

  it("scanning an already-late student never asks and never changes it", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    await scan(b.glv, an.qrToken, { mode: "late" });
    const again = await scan(b.glv, an.qrToken);
    expect(again.ok && again.data).toMatchObject({ result: "noop", reason: "already_late", status: "late" });
    expect((await rows(an.id))[0].status).toBe("late");
  });

  it("an absent student needs confirmation; nothing is written until confirmed", async () => {
    const { db, b, session, kid, scan, rows } = await setup();
    const an = await kid("An");
    await setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "absent_unexcused", reason: "ốm" });
    const asked = await scan(b.glv, an.qrToken, { mode: "late" });
    expect(asked.ok && asked.data).toMatchObject({ result: "needs_confirm", current: "absent_unexcused", defaultStatus: "late", status: "absent_unexcused" });
    expect((await rows(an.id))[0].status).toBe("absent_unexcused");
    expect(await db.select().from(attendanceScans)).toHaveLength(0);

    const confirmed = await scan(b.glv, an.qrToken, { mode: "late", confirmStatus: "present" });
    expect(confirmed.ok && confirmed.data).toMatchObject({ result: "applied", status: "present" });
    const [log] = await db.select().from(attendanceScans);
    expect(log).toMatchObject({ prevStatus: "absent_unexcused", prevReason: "ốm", newStatus: "present" });
  });

  it("manual (find by name) uses the same rules with a studentId", async () => {
    const { b, kid, eid, session, db, rows } = await setup();
    const an = await kid("An");
    const r = await applyScan(db, b.glv, { eventId: eid(), sessionId: session.id, kind: "manual", studentId: an.id, mode: "present" });
    expect(r.ok && r.data.result).toBe("applied");
    expect((await rows(an.id))[0].status).toBe("present");
  });
});

describe("applyScan: rejections (nothing is written)", () => {
  it("unknown, rotated, hidden and other-class cards all get the same message", async () => {
    const { db, b, kid, scan } = await setup();
    const hidden = await kid("Ẩn", { active: false });
    const stranger = await kid("Lạ", {}, b.otherClassId);
    const rotated = await kid("Đổi");
    const oldToken = rotated.qrToken;
    await db.update(students).set({ qrToken: "f".repeat(32) }).where(eq(students.id, rotated.id));
    const messages = new Set<string>();
    for (const token of ["a".repeat(32), hidden.qrToken, stranger.qrToken, oldToken]) {
      const r = await scan(b.glv, token);
      expect(r).toMatchObject({ ok: false, code: "invalid_card" });
      if (!r.ok) messages.add(r.error);
    }
    expect([...messages]).toEqual(["Thẻ không dùng được cho lớp này"]);
    expect(await db.select().from(attendance)).toHaveLength(0);
    expect(await db.select().from(attendanceScans)).toHaveLength(0);
  });

  it("manual with a student of another class is refused", async () => {
    const { db, b, eid, session, kid } = await setup();
    const stranger = await kid("Lạ", {}, b.otherClassId);
    const r = await applyScan(db, b.glv, { eventId: eid(), sessionId: session.id, kind: "manual", studentId: stranger.id, mode: "present" });
    expect(r).toMatchObject({ ok: false, code: "invalid_card" });
  });

  it("read-only head, other catechists and unknown sessions all look like 'not found'", async () => {
    const { b, kid, scan } = await setup();
    const an = await kid("An");
    const forHead = await scan(b.head, an.qrToken);
    const forOther = await scan(b.otherGlv, an.qrToken);
    const unknown = await scan(b.glv, an.qrToken, {}, crypto.randomUUID());
    for (const r of [forHead, forOther, unknown]) expect(r).toMatchObject({ ok: false, code: "forbidden", error: "Không tìm thấy buổi học" });
  });

  it("a cancelled session rejects scans", async () => {
    const { db, b, session, kid, scan } = await setup();
    const an = await kid("An");
    await db.update(sessions).set({ cancelled: true }).where(eq(sessions.id, session.id));
    expect(await scan(b.glv, an.qrToken)).toMatchObject({ ok: false, code: "cancelled" });
  });

  it("rejects malformed input", async () => {
    const { db, b } = await setup();
    for (const bad of [null, {}, { eventId: "x" }, { eventId: crypto.randomUUID(), sessionId: crypto.randomUUID(), kind: "scan", token: "short", mode: "present" }]) {
      expect(await applyScan(db, b.glv, bad)).toMatchObject({ ok: false, code: "bad_request" });
    }
  });
});

describe("applyScan: idempotency and races", () => {
  it("the same event sent twice returns the same result and logs once", async () => {
    const { db, b, kid, scan } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const first = await scan(b.glv, an.qrToken, { eventId });
    const second = await scan(b.glv, an.qrToken, { eventId });
    expect(second).toEqual(first);
    expect(await db.select().from(attendanceScans)).toHaveLength(1);
  });

  it("the same event id with a different payload or actor is a conflict", async () => {
    const { db, b, kid, scan } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    await scan(b.glv, an.qrToken, { eventId });
    expect(await scan(b.glv, an.qrToken, { eventId, mode: "late" })).toMatchObject({ ok: false, code: "event_conflict" });
    const [second] = await db.insert(users).values({ email: "glv2@x.vn", name: "G2", passwordHash: "x", gradeId: b.gradeId }).returning();
    await db.insert(classCatechists).values({ classId: b.classId, userId: second.id });
    expect(await scan(second, an.qrToken, { eventId })).toMatchObject({ ok: false, code: "event_conflict" });
  });

  it("five identical concurrent requests leave one row, one log and the same answer", async () => {
    const { db, b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const eventId = crypto.randomUUID();
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => scan(b.glv, an.qrToken, { eventId })));
    for (const r of all) expect(r).toEqual(all[0]);
    expect(all[0]).toMatchObject({ ok: true, data: { result: "applied" } });
    expect(await rows(an.id)).toHaveLength(1);
    expect(await db.select().from(attendanceScans)).toHaveLength(1);
  });

  it("five different events for one student: one applied, four no-ops, one row", async () => {
    const { b, kid, scan, rows } = await setup();
    const an = await kid("An");
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => scan(b.glv, an.qrToken)));
    expect(all.filter((r) => r.ok && r.data.result === "applied")).toHaveLength(1);
    expect(all.filter((r) => r.ok && r.data.result === "noop")).toHaveLength(4);
    expect(await rows(an.id)).toHaveLength(1);
  });

  it("scanning many different students concurrently records them all", async () => {
    const { b, kid, scan, db } = await setup();
    const kids = await Promise.all(Array.from({ length: 30 }, (_, i) => kid(`Em ${i}`)));
    const all = await Promise.all(kids.map((k) => scan(b.glv, k.qrToken)));
    expect(all.every((r) => r.ok && r.data.result === "applied")).toBe(true);
    expect(await db.select().from(attendance)).toHaveLength(30);
  });
});
