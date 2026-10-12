import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { findSession, listSessions, unexcusedCount } from "@/db/queries/attendance";
import { sessionsHeld, termRecords } from "@/db/queries/stats";
import { studentTermRecords } from "@/db/queries/student-profile";
import { attendance, sessions, students } from "@/db/schema";
import { buildStatsWorkbook } from "@/lib/export/excel";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, markRemainingAbsent, openSession, readBoard, setStatus } from "./attendance";
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
    // Số buổi vắng KP trước đó vẫn chỉ tính buổi học.
    expect(roster?.students.find((s) => s.studentId === an.id)).toMatchObject({ status: null, priorUnexcused: 1 });

    const results = await getScanResults(db, b.glv, { sessionId, eventIds: [eventId] });
    expect(results).toEqual({ ok: true, data: { results: [{ eventId, kind: "scan", result: "applied", studentId: chi.id, status: "present" }] } });
  });

  it("mass absences do not raise the class priorUnexcused on the scan roster of a class session", async () => {
    const ctx = await setup();
    await ctx.addMass();
    const roster = await getScanRoster(ctx.db, ctx.b.glv, ctx.c2);
    expect(roster?.students.find((s) => s.studentId === ctx.an.id)?.priorUnexcused).toBe(1);
    expect(roster?.students.find((s) => s.studentId === ctx.binh.id)?.priorUnexcused).toBe(0);
  });
});
