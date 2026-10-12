import { describe, expect, it } from "vitest";
import { attendance, students } from "@/db/schema";
import { auditRows, breakAuditInserts, dataSnapshot } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, markRemainingAbsent, openSession, setCancelled, setStatus, undoMarkAllPresent } from "./attendance";
import { cancelMassSession, cancelMassWeek, markClassAtMass, setMassStatus, undoClassAtMass } from "./mass";
import { openMassSession } from "./mass-sessions";
import { applyScan } from "./scan";

const LATE_NOW = new Date("2027-02-01T05:00:00Z");
const SATURDAY = "2026-10-10";
const SUNDAY_BEFORE = "2026-10-04";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const [an, binh] = [await kid("An", { parentPhone: "0901234567" }), await kid("Bình")];
  const opened = await openSession(db, b.glv, { classId: b.classId, heldOn: SATURDAY }, LATE_NOW);
  if (!opened.ok) throw new Error(opened.error);
  const sessionId = opened.data.id;
  const day = (extra: object = {}) => ({ classId: b.classId, heldOn: SATURDAY, ...extra });
  return { db, b, kid, an, binh, sessionId, day };
}

describe("attendance.set (setStatus)", () => {
  it("writes exactly one row per real change with before/after, the student name and the session", async () => {
    const { db, b, an, sessionId } = await setup();
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_excused", reason: "Ốm" });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: null, reason: null });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      actorId: b.glv.id, classId: b.classId, gradeId: null, entity: "attendance", entityId: an.id, action: "attendance.set",
      summary: {
        studentName: "An", sessionId, sessionDate: SATURDAY, sessionKind: "class",
        before: null, after: { status: "absent_excused", reason: "Ốm" },
      },
    });
    expect(rows[1].summary).toMatchObject({ before: { status: "absent_excused", reason: "Ốm" }, after: { status: "present", reason: null } });
    expect(rows[2].summary).toMatchObject({ before: { status: "present", reason: null }, after: null });
  });

  it("writes nothing for a no-op: same status and reason again, or clearing an unmarked student", async () => {
    const { db, b, an, binh, sessionId } = await setup();
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "late", reason: "Kẹt xe" });
    expect(await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "late", reason: "Kẹt xe" })).toMatchObject({ ok: true });
    expect(await setStatus(db, b.glv, { sessionId, studentId: binh.id, status: null, reason: null })).toMatchObject({ ok: true });
    expect(await auditRows(db)).toHaveLength(1);
  });

  it("still re-stamps a scanned row tapped to the same status (undo of that scan cannot delete it), without an audit row", async () => {
    const { db, b, an, sessionId } = await setup();
    const eventId = crypto.randomUUID();
    const scanned = await applyScan(db, b.glv, { eventId, sessionId, kind: "scan", token: an.qrToken, mode: "present" });
    expect(scanned.ok).toBe(true);
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null });
    const [row] = await db.select().from(attendance);
    expect(row).toMatchObject({ status: "present", lastEventId: null });
    expect(await auditRows(db)).toHaveLength(0); // lượt quét không ghi nhật ký; chạm cùng trạng thái không phải thay đổi
  });

  it("masks phone-like digits and hides card tokens typed into the reason", async () => {
    const { db, b, an, sessionId } = await setup();
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_excused", reason: `Mẹ gọi 0912 345 678, thẻ dd1.${an.qrToken}` });
    const [row] = await auditRows(db);
    expect(row.summary).toMatchObject({ after: { reason: "Mẹ gọi ••••••678, thẻ [ẩn]" } });
  });

  it("writes nothing when refused: read-only head, other class, foreign student, cancelled session, bad input", async () => {
    const { db, b, an, kid, sessionId } = await setup();
    const foreign = await kid("Ngoài", {}, b.otherClassId);
    expect((await setStatus(db, b.head, { sessionId, studentId: an.id, status: "present", reason: null })).ok).toBe(false);
    expect((await setStatus(db, b.otherGlv, { sessionId, studentId: an.id, status: "present", reason: null })).ok).toBe(false);
    expect((await setStatus(db, b.glv, { sessionId, studentId: foreign.id, status: "present", reason: null })).ok).toBe(false);
    expect((await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "bogus", reason: null })).ok).toBe(false);
    await setCancelled(db, b.glv, { sessionId, cancelled: true });
    expect((await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null })).ok).toBe(false);
    expect((await auditRows(db)).map((r) => r.action)).toEqual(["session.cancel"]);
  });
});

describe("attendance bulk actions: one summary row each, none when nothing changed", () => {
  it("markAllPresent and its undo", async () => {
    const { db, b, an, sessionId } = await setup();
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "late", reason: null });
    const bulk = await markAllPresent(db, b.glv, { sessionId });
    if (!bulk.ok) throw new Error(bulk.error);
    expect((await markAllPresent(db, b.glv, { sessionId })).ok).toBe(true); // không còn em nào: không ghi
    await undoMarkAllPresent(db, b.glv, { sessionId, batchId: bulk.data.batchId });
    await undoMarkAllPresent(db, b.glv, { sessionId, batchId: bulk.data.batchId }); // lần hai không xoá gì
    const rows = (await auditRows(db)).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actorId: b.glv.id, classId: b.classId, entity: "attendance", entityId: sessionId, action: "attendance.bulk_present",
      summary: { count: 1, batchId: bulk.data.batchId, sessionKind: "class", sessionDate: SATURDAY },
    });
    expect(rows[1]).toMatchObject({ action: "attendance.bulk_undo", entityId: sessionId, summary: { count: 1, batchId: bulk.data.batchId, sessionKind: "class" } });
  });

  it("markRemainingAbsent writes one row with the count, and none when no one is left", async () => {
    const { db, b, sessionId } = await setup();
    await markRemainingAbsent(db, b.glv, { sessionId });
    await markRemainingAbsent(db, b.glv, { sessionId });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "attendance.remaining_absent", entityId: sessionId, classId: b.classId, summary: { count: 2, sessionDate: SATURDAY, sessionKind: "class" } });
  });

  it("refused bulk actions write nothing", async () => {
    const { db, b, sessionId } = await setup();
    expect((await markAllPresent(db, b.head, { sessionId })).ok).toBe(false);
    expect((await markRemainingAbsent(db, b.otherGlv, { sessionId })).ok).toBe(false);
    expect((await undoMarkAllPresent(db, b.head, { sessionId, batchId: crypto.randomUUID() })).ok).toBe(false);
    expect(await auditRows(db)).toHaveLength(0);
  });
});

describe("mass marks (Sunday Mass of the class date)", () => {
  it("setMassStatus records attendance.set with sessionKind mass and the Sunday", async () => {
    const { db, b, an } = await setup();
    await setMassStatus(db, b.glv, { classId: b.classId, heldOn: SATURDAY, studentId: an.id, status: "present" }, LATE_NOW);
    await setMassStatus(db, b.glv, { classId: b.classId, heldOn: SATURDAY, studentId: an.id, status: "present" }, LATE_NOW);
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "attendance.set", entityId: an.id, summary: { sessionKind: "mass", sessionDate: SUNDAY_BEFORE, before: null, after: { status: "present", reason: null } } });
  });

  it("markClassAtMass / undoClassAtMass write one row each with kind mass", async () => {
    const { db, b, day } = await setup();
    const bulk = await markClassAtMass(db, b.glv, day(), LATE_NOW);
    if (!bulk.ok) throw new Error(bulk.error);
    await undoClassAtMass(db, b.glv, day({ batchId: bulk.data.batchId }), LATE_NOW);
    const rows = await auditRows(db);
    expect(rows.map((r) => [r.action, r.summary.count, r.summary.sessionKind, r.summary.sessionDate])).toEqual([
      ["attendance.bulk_present", 2, "mass", SUNDAY_BEFORE],
      ["attendance.bulk_undo", 2, "mass", SUNDAY_BEFORE],
    ]);
  });

  it("refused mass writes record nothing", async () => {
    const { db, b, an, day } = await setup();
    expect((await setMassStatus(db, b.head, day({ studentId: an.id, status: "present" }), LATE_NOW)).ok).toBe(false);
    expect((await markClassAtMass(db, b.otherGlv, day(), LATE_NOW)).ok).toBe(false);
    expect((await cancelMassWeek(db, b.head, day({ cancelled: true }), LATE_NOW)).ok).toBe(false);
    expect(await auditRows(db)).toHaveLength(0);
  });
});

describe("session.cancel / session.reopen", () => {
  it("records each real toggle with date and kind, nothing when the value does not change", async () => {
    const { db, b, sessionId } = await setup();
    await setCancelled(db, b.glv, { sessionId, cancelled: false });
    await setCancelled(db, b.glv, { sessionId, cancelled: true });
    await setCancelled(db, b.glv, { sessionId, cancelled: true });
    await setCancelled(db, b.glv, { sessionId, cancelled: false });
    expect(await setCancelled(db, b.head, { sessionId, cancelled: true })).toMatchObject({ ok: false });
    const rows = await auditRows(db);
    expect(rows.map((r) => r.action)).toEqual(["session.cancel", "session.reopen"]);
    expect(rows[0]).toMatchObject({ entity: "session", entityId: sessionId, classId: b.classId, actorId: b.glv.id, summary: { sessionDate: SATURDAY, sessionKind: "class" } });
  });

  it("mass week cancel from the board and from the church scan screen", async () => {
    const { db, b, day } = await setup();
    await cancelMassWeek(db, b.glv, day({ cancelled: true }), LATE_NOW);
    const opened = await openMassSession(db, b.glv, { classId: b.classId, heldOn: SUNDAY_BEFORE }, LATE_NOW);
    if (!opened.ok) throw new Error(opened.error);
    await cancelMassSession(db, b.glv, { sessionId: opened.data.id, cancelled: false });
    const rows = await auditRows(db);
    expect(rows.map((r) => [r.action, r.entityId, r.summary.sessionKind, r.summary.sessionDate])).toEqual([
      ["session.cancel", opened.data.id, "mass", SUNDAY_BEFORE],
      ["session.reopen", opened.data.id, "mass", SUNDAY_BEFORE],
    ]);
  });
});

describe("rollback: when the audit insert fails after the change, neither the change nor a row remains", () => {
  const cases: [string, (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>][] = [
    ["setStatus", ({ db, b, an, sessionId }) => setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null })],
    ["setMassStatus", ({ db, b, an, day }) => setMassStatus(db, b.glv, day({ studentId: an.id, status: "present" }), LATE_NOW)],
    ["markAllPresent", ({ db, b, sessionId }) => markAllPresent(db, b.glv, { sessionId })],
    ["markClassAtMass", ({ db, b, day }) => markClassAtMass(db, b.glv, day(), LATE_NOW)],
    ["markRemainingAbsent", ({ db, b, sessionId }) => markRemainingAbsent(db, b.glv, { sessionId })],
    ["setCancelled", ({ db, b, sessionId }) => setCancelled(db, b.glv, { sessionId, cancelled: true })],
  ];
  it.each(cases)("%s", async (_name, run) => {
    const s = await setup();
    const before = await dataSnapshot(s.db);
    await breakAuditInserts(s.db);
    await expect(run(s)).rejects.toThrow();
    const after = await dataSnapshot(s.db);
    // setMassStatus/markClassAtMass mở buổi đi lễ trước khi ghi (đã có từ trước Task 34, giống "mở buổi"): chỉ so dữ liệu điểm danh.
    expect(after.attendance).toEqual(before.attendance);
    expect(after.students).toEqual(before.students);
    if (_name === "setCancelled") expect(after.sessions).toEqual(before.sessions);
    expect(await auditRows(s.db)).toHaveLength(0);
  });

  it("undo of a bulk mark", async () => {
    const s = await setup();
    const bulk = await markAllPresent(s.db, s.b.glv, { sessionId: s.sessionId });
    if (!bulk.ok) throw new Error(bulk.error);
    const before = await dataSnapshot(s.db);
    await breakAuditInserts(s.db);
    await expect(undoMarkAllPresent(s.db, s.b.glv, { sessionId: s.sessionId, batchId: bulk.data.batchId })).rejects.toThrow();
    expect(await dataSnapshot(s.db)).toEqual(before);
  });
});
