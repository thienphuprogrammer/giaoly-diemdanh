import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { seedBasics, type Basics } from "@/test/fixtures";
import { createRealPgDb, realPgUrl } from "@/test/pg";
import { setStatus } from "./attendance";
import { applyScan, applyUndo } from "./scan";

/**
 * Đua thật trên Postgres (nhiều kết nối, READ COMMITTED). PGlite chỉ có một kết nối nên các
 * ca tương tự trong scan.test.ts chạy tuần tự; ở đây mỗi Promise.all thật sự chạy song song.
 */
const ROUNDS = 5;
const sqlPid = sql`select pg_backend_pid() as pid`;
const sqlSleep = sql`select pg_sleep(0.05)`;

describe.skipIf(!realPgUrl)("scan/undo races on real Postgres", () => {
  let db: Db;
  let b: Basics;
  let close: () => Promise<void>;
  let day = 0;

  beforeAll(async () => {
    ({ db, close } = await createRealPgDb(12));
    b = await seedBasics(db);
  });
  afterAll(async () => { await close?.(); });

  async function freshSession() {
    day += 1;
    const heldOn = new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn }).returning();
    return session;
  }
  const kid = async (fullName: string) => (await db.insert(students).values({ classId: b.classId, fullName }).returning())[0];
  const scan = (sessionId: string, token: string, extra: Record<string, unknown> = {}) =>
    applyScan(db, b.glv, { eventId: crypto.randomUUID(), sessionId, kind: "scan", token, mode: "present", ...extra });
  const undo = (sessionId: string, targetEventId: string, eventId: string = crypto.randomUUID()) =>
    applyUndo(db, b.glv, { eventId, sessionId, targetEventId });
  const rowsOf = (sessionId: string, studentId: string) =>
    db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId)));
  const logsOf = (sessionId: string) => db.select().from(attendanceScans).where(eq(attendanceScans.sessionId, sessionId));

  it("runs on more than one connection (otherwise nothing races)", async () => {
    const pids = await Promise.all(Array.from({ length: 6 }, () =>
      db.transaction(async (tx) => {
        const [r] = await tx.execute<{ pid: number }>(sqlPid);
        await tx.execute(sqlSleep);
        return (r as { pid: number }).pid;
      })));
    expect(new Set(pids).size).toBeGreaterThan(1);
  });

  it("5 identical requests (same event) → one row, one log entry, identical answers", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const session = await freshSession();
      const an = await kid(`Same ${round}`);
      const eventId = crypto.randomUUID();
      const all = await Promise.all(Array.from({ length: 5 }, () => scan(session.id, an.qrToken, { eventId })));
      for (const r of all) expect(r).toEqual(all[0]);
      expect(all[0]).toMatchObject({ ok: true, data: { eventId, result: "applied", status: "present" } });
      expect(await rowsOf(session.id, an.id)).toHaveLength(1);
      expect(await logsOf(session.id)).toHaveLength(1);
      // gửi lại sau khi đã xong vẫn trả đúng kết quả cũ, không ghi thêm
      expect(await scan(session.id, an.qrToken, { eventId })).toEqual(all[0]);
      expect(await logsOf(session.id)).toHaveLength(1);
    }
  });

  it("5 different events for one student → one applied, four no-ops, one row, one log entry per event", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const session = await freshSession();
      const an = await kid(`Diff ${round}`);
      const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
      const all = await Promise.all(ids.map((eventId) => scan(session.id, an.qrToken, { eventId })));
      expect(all.every((r) => r.ok)).toBe(true);
      expect(all.filter((r) => r.ok && r.data.result === "applied")).toHaveLength(1);
      expect(all.filter((r) => r.ok && r.data.result === "noop")).toHaveLength(4);
      const [row] = await rowsOf(session.id, an.id);
      expect(row.status).toBe("present");
      const logs = await logsOf(session.id);
      expect(logs.map((l) => l.eventId).sort()).toEqual([...ids].sort());
      const applied = logs.filter((l) => l.result === "applied");
      expect(applied).toHaveLength(1);
      expect(row.lastEventId).toBe(applied[0].eventId);
      // mỗi mã lượt gửi lại đều được trả đúng kết quả đã lưu
      const replays = await Promise.all(ids.map((eventId) => scan(session.id, an.qrToken, { eventId })));
      expect(replays).toEqual(all);
      expect(await logsOf(session.id)).toHaveLength(5);
    }
  });

  it("30 students scanned in parallel are all recorded once", async () => {
    const session = await freshSession();
    const kids = await db.insert(students).values(Array.from({ length: 30 }, (_, i) => ({ classId: b.classId, fullName: `Par ${i}` }))).returning();
    const all = await Promise.all(kids.map((k) => scan(session.id, k.qrToken)));
    expect(all.every((r) => r.ok && r.data.result === "applied")).toBe(true);
    expect(await db.select().from(attendance).where(eq(attendance.sessionId, session.id))).toHaveLength(30);
    expect(await logsOf(session.id)).toHaveLength(30);
  });

  it("5 different undos of one scan → exactly one applies, the rest conflict", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const session = await freshSession();
      const an = await kid(`UndoDiff ${round}`);
      const first = await scan(session.id, an.qrToken);
      const target = first.ok ? first.data.eventId : "";
      const all = await Promise.all(Array.from({ length: 5 }, () => undo(session.id, target)));
      expect(all.filter((r) => r.ok)).toHaveLength(1);
      expect(all.filter((r) => !r.ok && r.code === "conflict")).toHaveLength(4);
      expect(await rowsOf(session.id, an.id)).toHaveLength(0);
      expect((await logsOf(session.id)).filter((l) => l.kind === "undo")).toHaveLength(1);
    }
  });

  it("5 identical undo requests (same event) → same stored answer, one undo log entry", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const session = await freshSession();
      const an = await kid(`UndoSame ${round}`);
      const first = await scan(session.id, an.qrToken);
      const target = first.ok ? first.data.eventId : "";
      const eventId = crypto.randomUUID();
      const all = await Promise.all(Array.from({ length: 5 }, () => undo(session.id, target, eventId)));
      for (const r of all) expect(r).toEqual({ ok: true, data: { eventId, targetEventId: target, studentId: an.id, status: null } });
      expect(await rowsOf(session.id, an.id)).toHaveLength(0);
      expect((await logsOf(session.id)).filter((l) => l.kind === "undo")).toHaveLength(1);
      expect(await undo(session.id, target, eventId)).toEqual(all[0]);
    }
  });

  it("undo racing a new scan of the same student leaves the row consistent with the log", async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      const session = await freshSession();
      const an = await kid(`UndoScan ${round}`);
      const first = await scan(session.id, an.qrToken);
      const target = first.ok ? first.data.eventId : "";
      const [u, s] = await Promise.all([undo(session.id, target), scan(session.id, an.qrToken, { mode: "late" })]);
      expect(u.ok || (!u.ok && u.code === "conflict")).toBe(true);
      expect(s.ok).toBe(true);
      const rows = await rowsOf(session.id, an.id);
      const logs = await logsOf(session.id);
      if (rows.length === 1) {
        // dòng còn lại phải do đúng một lượt quét đã ghi, và trạng thái khớp nhật ký
        const owner = logs.find((l) => l.eventId === rows[0].lastEventId);
        expect(owner).toMatchObject({ result: "applied", newStatus: rows[0].status });
      } else {
        // không còn dòng: lượt hoàn tác đã thắng sau cùng
        expect(u.ok).toBe(true);
        expect(s.ok && s.data.result).toBe("noop");
      }
    }
  });

  it("undo racing a manual edit never loses the manual edit", async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      const session = await freshSession();
      const an = await kid(`UndoManual ${round}`);
      const first = await scan(session.id, an.qrToken);
      const target = first.ok ? first.data.eventId : "";
      const [u, m] = await Promise.all([
        undo(session.id, target),
        setStatus(db, b.glv, { sessionId: session.id, studentId: an.id, status: "late", reason: null }),
      ]);
      expect(m.ok).toBe(true);
      expect(u.ok || (!u.ok && u.code === "conflict")).toBe(true);
      const [row] = await rowsOf(session.id, an.id);
      expect(row).toMatchObject({ status: "late", lastEventId: null });
    }
  });
});

