import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, openSession, setCancelled, setStatus } from "./attendance";
import { markClassAtMass, readMassMarks, setMassStatus, undoClassAtMass } from "./mass";
import { openMassForClassDate } from "./mass-sessions";

const LATE_NOW = new Date("2027-02-01T05:00:00Z");
const SATURDAY = "2026-10-10";
const SUNDAY_BEFORE = "2026-10-04";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  const [an, binh, chi] = [await kid("An"), await kid("Bình"), await kid("Chi")];
  const input = (extra: object = {}) => ({ classId: b.classId, heldOn: SATURDAY, ...extra });
  const massRows = async () => {
    const rows = await db.select({ studentId: attendance.studentId, status: attendance.status, lastEventId: attendance.lastEventId, updatedBy: attendance.updatedBy, kind: sessions.kind, heldOn: sessions.heldOn })
      .from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId)).where(eq(sessions.classId, b.classId));
    return rows;
  };
  const statusOf = async (studentId: string) =>
    (await massRows()).find((r) => r.studentId === studentId && r.kind === "mass")?.status ?? null;
  return { db, b, an, binh, chi, kid, input, massRows, statusOf };
}

describe("readMassMarks", () => {
  it("before any write: the Sunday of the class date, no session, nothing marked; nothing is created", async () => {
    const { db, b, input } = await setup();
    expect(await readMassMarks(db, b.glv, input())).toEqual({ sunday: SUNDAY_BEFORE, sessionId: null, cancelled: false, canWrite: true, marks: {} });
    expect(await readMassMarks(db, b.head, input())).toMatchObject({ canWrite: false, marks: {} });
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("is null for readers outside the class and for bad input", async () => {
    const { db, b, input } = await setup();
    expect(await readMassMarks(db, b.otherGlv, input())).toBeNull();
    expect(await readMassMarks(db, b.glv, input({ heldOn: "2026-02-30" }))).toBeNull();
    expect(await readMassMarks(db, b.glv, input({ classId: "nope" }))).toBeNull();
    expect(await readMassMarks(db, b.glv, null)).toBeNull();
  });

  it("returns the marks of that Sunday's Mass only (not the class session), active students only, never 'late'", async () => {
    const { db, b, an, binh, chi, kid, input } = await setup();
    const gone = await kid("Đã nghỉ", { active: false });
    const mass = await openMassForClassDate(db, b.glv, input(), LATE_NOW);
    const cls = await openSession(db, b.glv, { classId: b.classId, heldOn: SATURDAY }, LATE_NOW);
    if (!mass.ok || !cls.ok) throw new Error("open failed");
    await db.insert(attendance).values([
      { sessionId: mass.data.id, studentId: an.id, status: "late" },
      { sessionId: mass.data.id, studentId: binh.id, status: "absent_excused", reason: "Ốm" },
      { sessionId: mass.data.id, studentId: gone.id, status: "present" },
      { sessionId: cls.data.id, studentId: chi.id, status: "present" },
    ]);
    expect(await readMassMarks(db, b.head, input())).toEqual({
      sunday: SUNDAY_BEFORE, sessionId: mass.data.id, cancelled: false, canWrite: false,
      marks: { [an.id]: { status: "present", reason: null }, [binh.id]: { status: "absent_excused", reason: "Ốm" } },
    });
  });
});

describe("setMassStatus", () => {
  it("first write opens the Mass of the Sunday before a Saturday class; manual write: lastEventId null, updatedBy set", async () => {
    const { db, b, an, input, massRows } = await setup();
    expect(await setMassStatus(db, b.glv, input({ studentId: an.id, status: "present" }), LATE_NOW)).toEqual({ ok: true, data: undefined });
    expect(await massRows()).toEqual([{ studentId: an.id, status: "present", lastEventId: null, updatedBy: b.glv.id, kind: "mass", heldOn: SUNDAY_BEFORE }]);
    expect(await db.select().from(sessions)).toHaveLength(1); // không mở buổi học
  });

  it("supports the four states: present, excused, unexcused and null (= chưa hỏi, row removed)", async () => {
    const { db, b, an, input, statusOf } = await setup();
    const set = (status: unknown) => setMassStatus(db, b.glv, input({ studentId: an.id, status }), LATE_NOW);
    await set("absent_excused");
    expect(await statusOf(an.id)).toBe("absent_excused");
    await set("absent_unexcused");
    expect(await statusOf(an.id)).toBe("absent_unexcused");
    await set(null);
    expect(await statusOf(an.id)).toBeNull();
  });

  it("'chưa hỏi' before anything was recorded creates no Mass session", async () => {
    const { db, b, an, input } = await setup();
    expect((await setMassStatus(db, b.glv, input({ studentId: an.id, status: null }), LATE_NOW)).ok).toBe(true);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("rejects 'late' (there is no late at Mass) and writes nothing", async () => {
    const { db, b, an, input } = await setup();
    expect((await setMassStatus(db, b.glv, input({ studentId: an.id, status: "late" }), LATE_NOW)).ok).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("only assigned catechists write; others get the same 'not found' and nothing is created", async () => {
    const { db, b, an, input } = await setup();
    const head = await setMassStatus(db, b.head, input({ studentId: an.id, status: "present" }), LATE_NOW);
    expect(head).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect(await setMassStatus(db, b.otherGlv, input({ studentId: an.id, status: "present" }), LATE_NOW)).toEqual(head);
    expect(await setMassStatus(db, b.head, input({ studentId: an.id, status: null }), LATE_NOW)).toEqual(head);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("rejects a student of another class or an inactive one", async () => {
    const { db, b, input, kid } = await setup();
    const gone = await kid("Đã nghỉ", { active: false });
    const [other] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Lớp khác" }).returning();
    for (const id of [gone.id, other.id, "not-a-uuid"]) {
      expect(await setMassStatus(db, b.glv, input({ studentId: id, status: "present" }), LATE_NOW)).toEqual({ ok: false, error: "Không tìm thấy thiếu nhi" });
    }
    expect(await db.select().from(attendance)).toHaveLength(0);
  });

  it("refuses to write when that Mass was marked cancelled", async () => {
    const { db, b, an, input } = await setup();
    const mass = await openMassForClassDate(db, b.glv, input(), LATE_NOW);
    if (!mass.ok) throw new Error(mass.error);
    await setCancelled(db, b.glv, { sessionId: mass.data.id, cancelled: true });
    expect(await setMassStatus(db, b.glv, input({ studentId: an.id, status: "present" }), LATE_NOW)).toEqual({ ok: false, error: "Buổi này đã được đánh dấu nghỉ lễ" });
  });
});

describe("markClassAtMass / undoClassAtMass ('Cả lớp đi lễ' with an 8 s undo)", () => {
  it("fills 'present' for students not asked yet, tagged with one batch id; existing answers are kept", async () => {
    const { db, b, an, binh, chi, input, massRows } = await setup();
    await setMassStatus(db, b.glv, input({ studentId: binh.id, status: "absent_excused" }), LATE_NOW);
    const r = await markClassAtMass(db, b.glv, input(), LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.marked).toBe(2);
    expect([...r.data.studentIds].sort()).toEqual([an.id, chi.id].sort());
    const rows = await massRows();
    expect(rows.find((x) => x.studentId === binh.id)).toMatchObject({ status: "absent_excused", lastEventId: null });
    expect(rows.filter((x) => x.lastEventId === r.data.batchId).map((x) => x.status)).toEqual(["present", "present"]);
    expect(rows.every((x) => x.kind === "mass" && x.heldOn === SUNDAY_BEFORE)).toBe(true);
    const again = await markClassAtMass(db, b.glv, input(), LATE_NOW);
    expect(again.ok && again.data.marked).toBe(0);
  });

  it("undo removes only rows still from that batch: a student changed since (other device) keeps the newer answer", async () => {
    const { db, b, an, binh, chi, input, statusOf } = await setup();
    const r = await markClassAtMass(db, b.glv, input(), LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    // Thiết bị khác sửa Bình sau lần "Cả lớp đi lễ".
    await setMassStatus(db, b.glv, input({ studentId: binh.id, status: "absent_unexcused" }), LATE_NOW);
    const undo = await undoClassAtMass(db, b.glv, input({ batchId: r.data.batchId }), LATE_NOW);
    expect(undo.ok && [...undo.data.studentIds].sort()).toEqual([an.id, chi.id].sort());
    expect(await statusOf(binh.id)).toBe("absent_unexcused");
    expect(await statusOf(an.id)).toBeNull();
    // Idempotent.
    expect(await undoClassAtMass(db, b.glv, input({ batchId: r.data.batchId }), LATE_NOW)).toEqual({ ok: true, data: { studentIds: [] } });
  });

  it("undo never touches the class session, even with the class session's own batch id", async () => {
    const { db, b, an, input } = await setup();
    const cls = await openSession(db, b.glv, { classId: b.classId, heldOn: SATURDAY }, LATE_NOW);
    if (!cls.ok) throw new Error(cls.error);
    const classBatch = await markAllPresent(db, b.glv, { sessionId: cls.data.id });
    if (!classBatch.ok) throw new Error(classBatch.error);
    await markClassAtMass(db, b.glv, input(), LATE_NOW);
    const undo = await undoClassAtMass(db, b.glv, input({ batchId: classBatch.data.batchId }), LATE_NOW);
    expect(undo).toEqual({ ok: true, data: { studentIds: [] } });
    const classRows = await db.select().from(attendance).where(and(eq(attendance.sessionId, cls.data.id), eq(attendance.studentId, an.id)));
    expect(classRows).toHaveLength(1);
  });

  it("undo with no Mass recorded yet is a no-op and creates nothing", async () => {
    const { db, b, input } = await setup();
    expect(await undoClassAtMass(db, b.glv, input({ batchId: crypto.randomUUID() }), LATE_NOW)).toEqual({ ok: true, data: { studentIds: [] } });
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("writers only; bad batch id rejected", async () => {
    const { db, b, input } = await setup();
    expect(await markClassAtMass(db, b.head, input(), LATE_NOW)).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect(await undoClassAtMass(db, b.otherGlv, input({ batchId: crypto.randomUUID() }), LATE_NOW)).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect((await undoClassAtMass(db, b.glv, input({ batchId: "x" }), LATE_NOW)).ok).toBe(false);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});

describe("no 'late' at Mass through the generic services", () => {
  it("setStatus refuses 'late' on a Mass session id but still allows it on a class session", async () => {
    const { db, b, an, input, statusOf } = await setup();
    const mass = await openMassForClassDate(db, b.glv, input(), LATE_NOW);
    const cls = await openSession(db, b.glv, { classId: b.classId, heldOn: SATURDAY }, LATE_NOW);
    if (!mass.ok || !cls.ok) throw new Error("open failed");
    expect(await setStatus(db, b.glv, { sessionId: mass.data.id, studentId: an.id, status: "late", reason: null }))
      .toEqual({ ok: false, error: "Buổi đi lễ không có trạng thái đi muộn" });
    expect(await statusOf(an.id)).toBeNull();
    expect((await setStatus(db, b.glv, { sessionId: mass.data.id, studentId: an.id, status: "present", reason: null })).ok).toBe(true);
    expect((await setStatus(db, b.glv, { sessionId: cls.data.id, studentId: an.id, status: "late", reason: null })).ok).toBe(true);
  });
});
