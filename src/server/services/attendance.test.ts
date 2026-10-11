import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listSessions } from "@/db/queries/attendance";
import { attendance, seatAssignments, seatingPlans, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, openSession, readBoard, setCancelled, setStatus } from "./attendance";

// Mốc "bây giờ" sau mọi ngày dùng trong test để kiểm tra ngày tương lai không ảnh hưởng.
const LATE_NOW = new Date("2027-02-01T05:00:00Z");

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const mk = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  const open = async (heldOn: string) => {
    const r = await openSession(db, b.glv, { classId: b.classId, heldOn }, LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    return r.data.id;
  };
  return { db, b, mk, open };
}

describe("openSession", () => {
  it("creates a session inside the term, including both boundary days", async () => {
    const { open } = await setup();
    await expect(open("2026-09-01")).resolves.toBeTruthy();
    await expect(open("2027-01-15")).resolves.toBeTruthy();
  });

  it("rejects dates outside every term and malformed dates", async () => {
    const { db, b } = await setup();
    expect(await openSession(db, b.glv, { classId: b.classId, heldOn: "2026-08-31" })).toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    expect((await openSession(db, b.glv, { classId: b.classId, heldOn: "11/10/2026" })).ok).toBe(false);
  });

  it("rejects a date later than today in Vietnam and accepts today", async () => {
    const { db, b } = await setup();
    const now = new Date("2026-10-11T05:00:00Z"); // 12:00 ngày 11/10 giờ VN
    const input = (heldOn: string) => ({ classId: b.classId, heldOn });
    expect((await openSession(db, b.glv, input("2026-10-11"), now)).ok).toBe(true);
    expect(await openSession(db, b.glv, input("2026-10-12"), now)).toEqual({ ok: false, error: "Không thể điểm danh cho ngày chưa tới" });
  });

  it("uses the Vietnam calendar day around midnight", async () => {
    const { db, b } = await setup();
    const input = (heldOn: string) => ({ classId: b.classId, heldOn });
    const beforeMidnight = new Date("2026-10-11T16:59:00Z"); // 23:59 ngày 11/10 giờ VN
    const afterMidnight = new Date("2026-10-11T17:01:00Z"); // 00:01 ngày 12/10 giờ VN
    expect((await openSession(db, b.glv, input("2026-10-12"), beforeMidnight)).ok).toBe(false);
    expect((await openSession(db, b.glv, input("2026-10-12"), afterMidnight)).ok).toBe(true);
    expect((await openSession(db, b.glv, input("2026-10-13"), afterMidnight)).ok).toBe(false);
  });

  it("is idempotent: opening the same day twice returns the same session", async () => {
    const { open } = await setup();
    expect(await open("2026-10-11")).toBe(await open("2026-10-11"));
  });

  it("is forbidden for other catechists and read-only heads", async () => {
    const { db, b } = await setup();
    expect((await openSession(db, b.otherGlv, { classId: b.classId, heldOn: "2026-10-11" })).ok).toBe(false);
    expect((await openSession(db, b.head, { classId: b.classId, heldOn: "2026-10-11" })).ok).toBe(false);
  });
});

describe("setStatus", () => {
  it("upserts, and clears the record when status is null", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const sessionId = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "present", reason: null });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_excused", reason: "ốm" });
    const [row] = await db.select().from(attendance);
    expect(row).toMatchObject({ status: "absent_excused", reason: "ốm", updatedBy: b.glv.id });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: null, reason: null });
    expect(await db.select().from(attendance)).toHaveLength(0);
  });

  it("keeps exactly one row for double taps and concurrent writes", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const sessionId = await open("2026-10-11");
    const input = { sessionId, studentId: an.id, status: "absent_unexcused" as const, reason: null };
    await Promise.all([1, 2, 3, 4, 5].map(() => setStatus(db, b.glv, input)));
    expect(await db.select().from(attendance)).toHaveLength(1);
  });

  it("returns a warning that counts other sessions of the term", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    const first = await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(first.ok && first.data.warning.level).toBe("watch");
    const second = await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(second.ok && second.data.warning).toEqual({ level: "warning", unexcused: 2, remaining: 0 });
  });

  it("does not count late or excused toward the warning, nor cancelled sessions", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    await setCancelled(db, b.glv, { sessionId: s1, cancelled: true });
    const r = await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    expect(r.ok && r.data.warning.level).toBe("watch");
  });

  it("rejects a cancelled session, hidden students, other classes' students and strangers", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const hidden = await mk("Ẩn", { active: false });
    const [alien] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Lạ" }).returning();
    const sessionId = await open("2026-10-11");
    const call = (studentId: string, user = b.glv) => setStatus(db, user, { sessionId, studentId, status: "present", reason: null });
    expect((await call(hidden.id)).ok).toBe(false);
    expect((await call(alien.id)).ok).toBe(false);
    expect((await call(an.id, b.otherGlv)).ok).toBe(false);
    await setCancelled(db, b.glv, { sessionId, cancelled: true });
    expect(await call(an.id)).toEqual({ ok: false, error: "Buổi này đã được đánh dấu nghỉ lễ" });
  });
});

describe("markAllPresent", () => {
  it("fills only unmarked active students and keeps existing marks", async () => {
    const { db, b, mk, open } = await setup();
    const [an, binh] = [await mk("An"), await mk("Bình")];
    await mk("Ẩn", { active: false });
    const sessionId = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_unexcused", reason: null });
    const r = await markAllPresent(db, b.glv, { sessionId });
    expect(r).toEqual({ ok: true, data: { marked: 1 } });
    const rows = await db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, binh.id)));
    expect(rows[0].status).toBe("present");
    expect((await db.select().from(attendance)).find((x) => x.studentId === an.id)?.status).toBe("absent_unexcused");
  });
});

describe("readBoard and listSessions", () => {
  it("returns prior unexcused counts from other sessions, hides inactive students", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    await mk("Ẩn", { active: false });
    const s1 = await open("2026-10-04");
    const s2 = await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    await setStatus(db, b.glv, { sessionId: s2, studentId: an.id, status: "absent_unexcused", reason: null });
    const board = await readBoard(db, b.glv, s2);
    expect(board?.students).toHaveLength(1);
    expect(board?.students[0]).toMatchObject({ id: an.id, status: "absent_unexcused", priorUnexcused: 1 });
    expect(board?.canWrite).toBe(true);
  });

  it("drops seat assignments of students who were hidden after being seated", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const binh = await mk("Bình");
    const layout = [{ id: "r1", items: [{ type: "bench" as const, id: "b1", seats: 2 }] }];
    const [plan] = await db.insert(seatingPlans).values({ classId: b.classId, name: "Sơ đồ", layout, isActive: true }).returning();
    await db.insert(seatAssignments).values([
      { planId: plan.id, benchId: "b1", seatIndex: 0, studentId: an.id },
      { planId: plan.id, benchId: "b1", seatIndex: 1, studentId: binh.id },
    ]);
    await db.update(students).set({ active: false }).where(eq(students.id, binh.id));
    const board = await readBoard(db, b.glv, await open("2026-10-11"));
    expect(board?.plan?.assignments).toEqual([{ benchId: "b1", seatIndex: 0, studentId: an.id }]);
  });

  it("is read-only for the grade head and null for outsiders", async () => {
    const { db, b, open } = await setup();
    const sessionId = await open("2026-10-11");
    expect((await readBoard(db, b.head, sessionId))?.canWrite).toBe(false);
    expect(await readBoard(db, b.otherGlv, sessionId)).toBeNull();
    expect(await readBoard(db, b.glv, "not-a-uuid")).toBeNull();
  });

  it("lists sessions newest first with mark counts", async () => {
    const { db, b, mk, open } = await setup();
    const an = await mk("An");
    const s1 = await open("2026-10-04");
    await open("2026-10-11");
    await setStatus(db, b.glv, { sessionId: s1, studentId: an.id, status: "absent_unexcused", reason: null });
    const list = await listSessions(db, b.classId);
    expect(list.map((s) => s.heldOn)).toEqual(["2026-10-11", "2026-10-04"]);
    expect(list[1]).toMatchObject({ marked: 1, absent: 1 });
  });
});
