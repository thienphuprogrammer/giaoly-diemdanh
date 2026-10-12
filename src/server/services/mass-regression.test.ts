import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { findSession, listSessions, unexcusedCount } from "@/db/queries/attendance";
import { sessionsHeld, termRecords } from "@/db/queries/stats";
import { studentTermRecords } from "@/db/queries/student-profile";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import { buildStatsWorkbook } from "@/lib/export/excel";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, markRemainingAbsent, openSession, readBoard, setStatus } from "./attendance";
import { markClassAtMass, setMassStatus, undoClassAtMass } from "./mass";
import { openMassSession } from "./mass-sessions";
import { applyScan, getScanResults, getScanRoster } from "./scan";
import { attentionList, classStats, gradeOverview } from "./stats";
import { getStudentProfile } from "./student-profile";

/**
 * Hồi quy Task 28: buổi đi lễ (`kind = 'mass'`) dùng chung bảng `attendance` nhưng KHÔNG được làm đổi bất kỳ số liệu
 * nào của buổi học: thống kê, "Cần chú ý", tổng quan khối, hồ sơ em, bảng điểm danh, danh sách buổi, xuất Excel,
 * "Đánh vắng còn lại".
 */
const LATE_NOW = new Date("2027-02-01T05:00:00Z");
const TODAY = "2026-10-20";
type Status = "present" | "absent_excused" | "absent_unexcused" | "late";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName }).returning())[0];
  const [an, binh, chi] = [await kid("An"), await kid("Bình"), await kid("Chi")];
  const open = async (heldOn: string) => {
    const r = await openSession(db, b.glv, { classId: b.classId, heldOn }, LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    return r.data.id;
  };
  const openMass = async (heldOn: string) => {
    const r = await openMassSession(db, b.glv, { classId: b.classId, heldOn }, LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    return r.data.id;
  };
  const mark = (sessionId: string, studentId: string, status: Status) =>
    db.insert(attendance).values({ sessionId, studentId, status });

  // Buổi học: An vắng KP 1 lần (mức "theo dõi"), Bình muộn + có phép, Chi chưa điểm danh buổi 11/10.
  const c1 = await open("2026-10-04");
  const c2 = await open("2026-10-11");
  await mark(c1, an.id, "absent_unexcused"); await mark(c1, binh.id, "late"); await mark(c1, chi.id, "present");
  await mark(c2, an.id, "present"); await mark(c2, binh.id, "absent_excused");

  /** Buổi đi lễ trùng ngày buổi học (11/10) và một Chúa nhật không có buổi học (18/10), toàn "vắng không phép". */
  const addMass = async () => {
    const m1 = await openMass("2026-10-11");
    const m2 = await openMass("2026-10-18");
    for (const m of [m1, m2]) {
      await mark(m, an.id, "absent_unexcused");
      await mark(m, binh.id, "absent_unexcused");
    }
    await mark(m1, chi.id, "absent_unexcused");
    return { m1, m2 };
  };
  return { db, b, an, binh, chi, c1, c2, addMass };
}

async function workbookValues(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const values: unknown[] = [];
  wb.worksheets[0].eachRow((row) => values.push(row.values));
  return values;
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function classNumbers({ db, b, an, c2 }: Ctx) {
  const stats = await classStats(db, b.glv, b.classId, b.termId);
  const board = await readBoard(db, b.glv, c2);
  const profile = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: an.id, today: TODAY });
  return {
    stats,
    excel: await workbookValues(await buildStatsWorkbook({ className: stats!.className, termName: stats!.term.name, rows: stats!.rows })),
    attentionGlv: await attentionList(db, b.glv, b.termId),
    attentionHead: await attentionList(db, b.head, b.termId),
    grade: await gradeOverview(db, b.head, b.termId),
    profile,
    board,
    sessionList: await listSessions(db, b.classId),
    classSessionOfDay: (await findSession(db, b.classId, "2026-10-11"))?.id,
    termRecords: await termRecords(db, [b.classId], b.termId),
    held: [...(await sessionsHeld(db, [b.classId], b.termId))],
    profileRecords: await studentTermRecords(db, an.id, b.termId),
    unexcused: await unexcusedCount(db, an.id, b.termId),
  };
}

describe("mass sessions do not change class-session numbers", () => {
  it("stats, attention, grade overview, profile, board, class page list, export and counts are unchanged", async () => {
    const ctx = await setup();
    const before = await classNumbers(ctx);
    // Sanity: số liệu "trước" đúng như dữ liệu buổi học.
    expect(before.stats!.rows.find((r) => r.studentId === ctx.an.id)!.summary).toMatchObject({ unexcused: 1, marked: 2 });
    expect(before.held).toEqual([[ctx.b.classId, 2]]);
    expect(before.sessionList.map((s) => s.heldOn)).toEqual(["2026-10-11", "2026-10-04"]);
    expect(before.board!.students.find((s) => s.id === ctx.an.id)!.priorUnexcused).toBe(1);

    const { m1 } = await ctx.addMass();
    const after = await classNumbers(ctx);
    expect(after).toEqual(before);
    expect(after.classSessionOfDay).toBe(ctx.c2);
    expect(after.classSessionOfDay).not.toBe(m1);
  });

  it("ticking Mass through the board services (Cả lớp đi lễ, per-student, undo) leaves every class number unchanged", async () => {
    const ctx = await setup();
    const before = await classNumbers(ctx);
    const { db, b, an, binh, chi } = ctx;
    // Lớp ngày 11/10 (Chúa nhật, trùng ngày buổi học) và một ngày thường 14/10 -> cùng thánh lễ 11/10.
    const all = await markClassAtMass(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    if (!all.ok) throw new Error(all.error);
    await setMassStatus(db, b.glv, { classId: b.classId, heldOn: "2026-10-14", studentId: an.id, status: "absent_unexcused" }, LATE_NOW);
    await setMassStatus(db, b.glv, { classId: b.classId, heldOn: "2026-10-14", studentId: binh.id, status: "absent_unexcused" }, LATE_NOW);
    await undoClassAtMass(db, b.glv, { classId: b.classId, heldOn: "2026-10-11", batchId: all.data.batchId }, LATE_NOW);
    await setMassStatus(db, b.glv, { classId: b.classId, heldOn: "2026-10-11", studentId: chi.id, status: "absent_unexcused" }, LATE_NOW);
    expect(await classNumbers(ctx)).toEqual(before);
    const massRows = await db.select({ status: attendance.status }).from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId)).where(eq(sessions.kind, "mass"));
    expect(massRows.map((r) => r.status)).toEqual(["absent_unexcused", "absent_unexcused", "absent_unexcused"]);
  });

  it("setStatus on a class session reports a warning that ignores mass absences", async () => {
    const ctx = await setup();
    await ctx.addMass();
    const r = await setStatus(ctx.db, ctx.b.glv, { sessionId: ctx.c2, studentId: ctx.binh.id, status: "absent_unexcused", reason: null });
    expect(r).toEqual({ ok: true, data: { warning: { level: "watch", unexcused: 1, remaining: 1 } } });
  });

  it("'Đánh vắng còn lại' of the class session only fills that session; mass rows do not count as marked", async () => {
    const ctx = await setup();
    const { m1 } = await ctx.addMass();
    const r = await markRemainingAbsent(ctx.db, ctx.b.glv, { sessionId: ctx.c2 });
    expect(r).toEqual({ ok: true, data: { marked: 1, studentIds: [ctx.chi.id] } });
    const massRows = await ctx.db.select().from(attendance).where(eq(attendance.sessionId, m1));
    expect(massRows).toHaveLength(3);
  });

  it("class-board actions refuse a mass session id (board, remaining absent)", async () => {
    const ctx = await setup();
    const { m2 } = await ctx.addMass();
    expect(await readBoard(ctx.db, ctx.b.glv, m2)).toBeNull();
    expect(await markRemainingAbsent(ctx.db, ctx.b.glv, { sessionId: m2 })).toEqual({ ok: false, error: "Không tìm thấy buổi học" });
    const rows = await ctx.db.select().from(attendance).where(eq(attendance.sessionId, m2));
    expect(rows).toHaveLength(2);
  });

  it("'Tất cả có mặt' on the class session ignores mass rows", async () => {
    const ctx = await setup();
    await ctx.addMass();
    const r = await markAllPresent(ctx.db, ctx.b.glv, { sessionId: ctx.c2 });
    expect(r.ok && r.data.studentIds).toEqual([ctx.chi.id]);
  });

  it("a mass session and a class session on the same day both exist", async () => {
    const ctx = await setup();
    const { m1 } = await ctx.addMass();
    const sameDay = await ctx.db.select({ id: sessions.id, kind: sessions.kind }).from(sessions)
      .where(and(eq(sessions.classId, ctx.b.classId), eq(sessions.heldOn, "2026-10-11")));
    expect(sameDay).toHaveLength(2);
    expect(new Map(sameDay.map((s) => [s.kind, s.id]))).toEqual(new Map([["class", ctx.c2], ["mass", m1]]));
  });
});

describe("scanning against a mass session id", () => {
  it("applies to the mass session only; roster and results work by session id", async () => {
    const ctx = await setup();
    const { db, b, chi, an, c2 } = ctx;
    const massId = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    if (!massId.ok) throw new Error(massId.error);
    const sessionId = massId.data.id;
    const eventId = crypto.randomUUID();
    const r = await applyScan(db, b.glv, { eventId, sessionId, kind: "scan", token: chi.qrToken, mode: "present" });
    expect(r).toMatchObject({ ok: true, data: { result: "applied", studentId: chi.id, status: "present" } });

    const massRow = await db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, chi.id)));
    expect(massRow).toMatchObject([{ status: "present", lastEventId: eventId }]);
    const classRow = await db.select().from(attendance).where(and(eq(attendance.sessionId, c2), eq(attendance.studentId, chi.id)));
    expect(classRow).toEqual([]);

    const roster = await getScanRoster(db, b.glv, sessionId);
    expect(roster?.sessionId).toBe(sessionId);
    expect(roster?.students.find((s) => s.studentId === chi.id)).toMatchObject({ status: "present" });
    // Bảng tra của buổi đi lễ: "vắng trước đó" là số tuần không đi lễ; vắng buổi học (An vắng KP 04/10) không tính.
    expect(roster?.students.find((s) => s.studentId === an.id)).toMatchObject({ status: null, priorUnexcused: 0 });

    const results = await getScanResults(db, b.glv, { sessionId, eventIds: [eventId] });
    expect(results).toEqual({ ok: true, data: { results: [{ eventId, kind: "scan", result: "applied", studentId: chi.id, status: "present" }] } });
  });

  it("refuses 'late' on a mass session (mode or confirmation) and writes nothing; 'present' still works", async () => {
    const { db, b, an, chi } = await setup();
    const mass = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    if (!mass.ok) throw new Error(mass.error);
    const sessionId = mass.data.id;
    const late = await applyScan(db, b.glv, { eventId: crypto.randomUUID(), sessionId, kind: "scan", token: chi.qrToken, mode: "late" });
    expect(late).toEqual({ ok: false, code: "bad_request", error: "Buổi đi lễ không có trạng thái đi muộn" });
    await db.insert(attendance).values({ sessionId, studentId: an.id, status: "absent_unexcused" });
    const confirmLate = await applyScan(db, b.glv, { eventId: crypto.randomUUID(), sessionId, kind: "manual", studentId: an.id, mode: "present", confirmStatus: "late" });
    expect(confirmLate).toMatchObject({ ok: false, code: "bad_request" });
    expect(await db.select().from(attendanceScans)).toHaveLength(0);
    const rows = await db.select({ studentId: attendance.studentId, status: attendance.status }).from(attendance).where(eq(attendance.sessionId, sessionId));
    expect(rows).toEqual([{ studentId: an.id, status: "absent_unexcused" }]);
    const present = await applyScan(db, b.glv, { eventId: crypto.randomUUID(), sessionId, kind: "scan", token: chi.qrToken, mode: "present" });
    expect(present).toMatchObject({ ok: true, data: { result: "applied", status: "present" } });
  });

  it("late scans on a class session still work", async () => {
    const { db, b, chi, c2 } = await setup();
    const r = await applyScan(db, b.glv, { eventId: crypto.randomUUID(), sessionId: c2, kind: "scan", token: chi.qrToken, mode: "late" });
    expect(r).toMatchObject({ ok: true, data: { result: "applied", status: "late" } });
  });

  it("mass absences do not raise the class priorUnexcused on the scan roster of a class session", async () => {
    const ctx = await setup();
    await ctx.addMass();
    const roster = await getScanRoster(ctx.db, ctx.b.glv, ctx.c2);
    expect(roster?.students.find((s) => s.studentId === ctx.an.id)?.priorUnexcused).toBe(1);
    expect(roster?.students.find((s) => s.studentId === ctx.binh.id)?.priorUnexcused).toBe(0);
  });

  it("the scan roster of a Mass session counts missed recorded Mass weeks (no present row), not class absences", async () => {
    const ctx = await setup();
    const { db, b, binh, chi } = ctx;
    const [dung] = await db.insert(students).values({ classId: b.classId, fullName: "Dũng" }).returning(); // không có dòng nào
    const { m2 } = await ctx.addMass(); // 11/10 và 18/10: An, Bình vắng KP cả hai; Chi vắng KP 11/10
    await db.update(attendance).set({ status: "absent_excused" }).where(and(eq(attendance.sessionId, m2), eq(attendance.studentId, binh.id)));
    await db.insert(attendance).values({ sessionId: m2, studentId: chi.id, status: "present" });
    await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-11-01" }, LATE_NOW); // mở mà chưa ghi: không tính
    const m3 = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-25" }, LATE_NOW);
    if (!m3.ok) throw new Error(m3.error);
    await db.insert(attendance).values({ sessionId: m3.data.id, studentId: chi.id, status: "present" }); // buổi đang quét: không tính
    const prior = async () => {
      const roster = await getScanRoster(db, b.glv, m3.data.id);
      return Object.fromEntries((roster?.students ?? []).map((s) => [s.fullName, s.priorUnexcused]));
    };
    expect(dung).toBeDefined();
    expect(await prior()).toEqual({ An: 2, "Bình": 2, Chi: 1, "Dũng": 2 });
    await db.update(sessions).set({ cancelled: true }).where(eq(sessions.id, m2)); // tuần không có lễ: không tính
    expect(await prior()).toEqual({ An: 1, "Bình": 1, Chi: 1, "Dũng": 1 });
  });
});
