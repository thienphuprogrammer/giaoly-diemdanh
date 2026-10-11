import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getSession, loadBoardData } from "@/db/queries/attendance";
import { findScanTarget, getScanEvent, updateMarkIfUnchanged, listClassTokens, listScanEvents, loadScanContext } from "@/db/queries/scan";
import { attendance, attendanceScans, students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { decideScan, type CurrentMark, type ScanDecision } from "@/lib/attendance/scan-rules";
import type { AttendanceStatus } from "@/lib/attendance/warning";
import { guardClass } from "../guard";
import { CANCELLED, NOT_FOUND_SESSION } from "./attendance";

export type ScanErrorCode =
  | "bad_request" | "forbidden" | "invalid_card" | "cancelled" | "event_conflict" | "conflict" | "rate_limited" | "unauthenticated";
export type ScanResponse<T> = { ok: true; data: T } | { ok: false; code: ScanErrorCode; error: string };

export interface ScanOutcome {
  eventId: string;
  result: "applied" | "noop" | "needs_confirm";
  studentId: string;
  fullName: string;
  saintName: string | null;
  status: AttendanceStatus | null;
  reason?: "already_present" | "already_late";
  current?: "absent_excused" | "absent_unexcused";
  defaultStatus?: "present" | "late";
}
export interface UndoOutcome { eventId: string; targetEventId: string; studentId: string; status: AttendanceStatus | null }

export const INVALID_CARD = "Thẻ không dùng được cho lớp này";
const reject = (code: ScanErrorCode, error: string) => ({ ok: false as const, code, error });
const success = <T,>(data: T): ScanResponse<T> => ({ ok: true, data });

const modeSchema = z.enum(["present", "late"]);
const scanSchema = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  mode: modeSchema,
  confirmStatus: modeSchema.optional(),
  capturedAt: z.iso.datetime().optional(),
}).and(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scan"), token: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ kind: z.literal("manual"), studentId: z.uuid() }),
]));
type ScanInput = z.infer<typeof scanSchema>;

const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const scanHash = (i: ScanInput) => hash([i.kind, i.sessionId, i.kind === "scan" ? i.token : i.studentId, i.mode, i.confirmStatus ?? null]);

function uniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
interface Target { id: string; fullName: string; saintName: string | null; lastEventId: string | null }

async function replay(db: Db, event: typeof attendanceScans.$inferSelect): Promise<ScanResponse<ScanOutcome>> {
  const [student] = event.studentId
    ? await db.select({ fullName: students.fullName, saintName: students.saintName }).from(students).where(eq(students.id, event.studentId))
    : [];
  return success({
    eventId: event.eventId,
    result: event.result,
    studentId: event.studentId ?? "",
    fullName: student?.fullName ?? "",
    saintName: student?.saintName ?? null,
    status: event.newStatus,
    ...(event.result === "noop" ? { reason: event.newStatus === "late" ? ("already_late" as const) : ("already_present" as const) } : {}),
  });
}

async function writeScan(tx: Tx, ctx: { sessionId: string }, input: ScanInput, user: AppUser, target: Target, current: CurrentMark | null, decision: ScanDecision): Promise<ScanOutcome | null> {
  const base = { eventId: input.eventId, studentId: target.id, fullName: target.fullName, saintName: target.saintName };
  const log = { eventId: input.eventId, kind: input.kind, sessionId: ctx.sessionId, studentId: target.id, actorId: user.id, mode: input.mode, payloadHash: scanHash(input), prevStatus: current?.status ?? null, prevReason: current?.reason ?? null, capturedAt: input.capturedAt ? new Date(input.capturedAt) : null };

  if (decision.kind === "noop") {
    await tx.insert(attendanceScans).values({ ...log, newStatus: current!.status, result: "noop" });
    return { ...base, result: "noop", status: current!.status, reason: decision.reason };
  }
  if (decision.kind !== "apply") return null;

  const values = { status: decision.status, reason: null, updatedBy: user.id, updatedAt: new Date(), lastEventId: input.eventId };
  const written = current === null
    ? (await tx.insert(attendance).values({ sessionId: ctx.sessionId, studentId: target.id, ...values }).onConflictDoNothing().returning({ s: attendance.status })).length > 0
    : await updateMarkIfUnchanged(tx, { sessionId: ctx.sessionId, studentId: target.id }, { ...current, lastEventId: target.lastEventId }, values);
  if (!written) return null; // người khác vừa đổi bản ghi: đọc lại và quyết định lại
  await tx.insert(attendanceScans).values({ ...log, newStatus: decision.status, result: "applied" });
  return { ...base, result: "applied", status: decision.status };
}

export async function applyScan(db: Db, user: AppUser, raw: unknown): Promise<ScanResponse<ScanOutcome>> {
  const parsed = scanSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const input = parsed.data;
  const ctx = await loadScanContext(db, user.id, input.sessionId, input.eventId);
  if (!ctx || !ctx.canWrite) return reject("forbidden", NOT_FOUND_SESSION);

  const sameRequest = (e: typeof attendanceScans.$inferSelect) => e.actorId === user.id && e.payloadHash === scanHash(input);
  if (ctx.event) {
    return sameRequest(ctx.event) ? replay(db, ctx.event) : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
  }
  if (ctx.cancelled) return reject("cancelled", CANCELLED);

  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await findScanTarget(db, ctx, input.kind === "scan" ? { token: input.token } : { studentId: input.studentId });
    if (!target) return reject("invalid_card", INVALID_CARD);
    const current = target.status ? { status: target.status, reason: target.reason } : null;
    const decision = decideScan(current, input.mode, input.confirmStatus);
    if (decision.kind === "confirm") {
      return success({ eventId: input.eventId, result: "needs_confirm", studentId: target.id, fullName: target.fullName, saintName: target.saintName, status: current!.status, current: decision.current, defaultStatus: decision.defaultStatus });
    }
    try {
      const outcome = await db.transaction((tx) => writeScan(tx, ctx, input, user, target, current, decision));
      if (outcome) return success(outcome);
    } catch (e) {
      if (!uniqueViolation(e)) throw e;
      const event = await getScanEvent(db, input.eventId); // yêu cầu trùng chạy song song đã commit trước
      if (!event) throw e;
      return sameRequest(event) ? replay(db, event) : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
    }
  }
  return reject("conflict", "Dữ liệu vừa thay đổi, hãy thử lại");
}

const undoSchema = z.object({ eventId: z.uuid(), sessionId: z.uuid(), targetEventId: z.uuid() });

export async function applyUndo(db: Db, user: AppUser, raw: unknown): Promise<ScanResponse<UndoOutcome>> {
  const parsed = undoSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const { eventId, sessionId, targetEventId } = parsed.data;
  const ctx = await loadScanContext(db, user.id, sessionId, eventId);
  if (!ctx || !ctx.canWrite) return reject("forbidden", NOT_FOUND_SESSION);
  const payloadHash = hash(["undo", sessionId, targetEventId]);
  const stored = (e: typeof attendanceScans.$inferSelect): ScanResponse<UndoOutcome> =>
    e.actorId === user.id && e.payloadHash === payloadHash
      ? success({ eventId, targetEventId, studentId: e.studentId ?? "", status: e.newStatus })
      : reject("event_conflict", "Mã lượt đã được dùng cho thao tác khác");
  if (ctx.event) return stored(ctx.event);
  if (ctx.cancelled) return reject("cancelled", CANCELLED);

  try {
    return await db.transaction(async (tx): Promise<ScanResponse<UndoOutcome>> => {
      const [target] = await tx.select().from(attendanceScans).where(and(eq(attendanceScans.eventId, targetEventId), eq(attendanceScans.sessionId, sessionId)));
      if (!target || target.result !== "applied" || target.kind === "undo" || !target.studentId) return reject("conflict", "Không có gì để hoàn tác");
      const key = and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, target.studentId));
      const [row] = await tx.select().from(attendance).where(key).for("update");
      if (!row || row.lastEventId !== targetEventId) return reject("conflict", "Bản ghi đã thay đổi, hãy kiểm tra lại");
      if (target.prevStatus === null) await tx.delete(attendance).where(key);
      else await tx.update(attendance).set({ status: target.prevStatus, reason: target.prevReason, updatedBy: user.id, updatedAt: new Date(), lastEventId: null }).where(key);
      await tx.insert(attendanceScans).values({
        eventId, kind: "undo", sessionId, studentId: target.studentId, actorId: user.id, payloadHash,
        prevStatus: row.status, prevReason: row.reason, newStatus: target.prevStatus, result: "applied", targetEventId,
      });
      return success({ eventId, targetEventId, studentId: target.studentId, status: target.prevStatus });
    });
  } catch (e) {
    if (!uniqueViolation(e)) throw e;
    const event = await getScanEvent(db, eventId);
    if (!event) throw e;
    return stored(event);
  }
}

export interface ScanRosterEntry {
  studentId: string; fullName: string; saintName: string | null; token: string;
  status: AttendanceStatus | null; reason: string | null; priorUnexcused: number;
}

/** Bảng tra cho màn quét: chỉ người có quyền ghi; có token nên TUYỆT ĐỐI không đưa vào trang/props khác. */
export async function getScanRoster(db: Db, user: AppUser, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return null;
  const [board, tokens] = await Promise.all([loadBoardData(db, session), listClassTokens(db, session.classId)]);
  const tokenOf = new Map(tokens.map((t) => [t.id, t.token]));
  const students: ScanRosterEntry[] = board.students.map((s) => ({
    studentId: s.id, fullName: s.fullName, saintName: s.saintName, token: tokenOf.get(s.id) ?? "",
    status: s.status, reason: s.reason, priorUnexcused: s.priorUnexcused,
  }));
  return { sessionId: session.id, classId: session.classId, heldOn: session.heldOn, cancelled: session.cancelled, students };
}

const resultsSchema = z.object({ sessionId: z.uuid(), eventIds: z.array(z.uuid()).max(50) });

export async function getScanResults(db: Db, user: AppUser, raw: unknown) {
  const parsed = resultsSchema.safeParse(raw);
  if (!parsed.success) return reject("bad_request", "Yêu cầu không hợp lệ");
  const session = await getSession(db, parsed.data.sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return reject("forbidden", NOT_FOUND_SESSION);
  const events = await listScanEvents(db, session.id, parsed.data.eventIds);
  return success({
    results: events.map((e) => ({ eventId: e.eventId, kind: e.kind, result: e.result, studentId: e.studentId, status: e.newStatus })),
  });
}
