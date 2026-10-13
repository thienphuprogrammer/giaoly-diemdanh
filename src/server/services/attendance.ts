import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { findSession, findTermFor, getMark, getSession, getStudentWithMark, loadBoardData, unexcusedCount, type BoardStudent } from "@/db/queries/attendance";
import { getStudent } from "@/db/queries/students";
import { getClassById } from "@/db/queries/classes";
import { attendance, sessions, students, type SessionKind } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { todayInVietnam } from "@/lib/dates";
import { evaluateWarningFromCount, type AttendanceStatus, type WarningResult } from "@/lib/attendance/warning";
import type { Assignment, Layout } from "@/lib/seating/types";
import { recordAudit, writeWithAudit, type AuditEvent } from "../audit";
import { NOT_FOUND, classPermissions, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
export const NOT_FOUND_SESSION = "Không tìm thấy buổi học";
export const CANCELLED = "Buổi này đã được đánh dấu nghỉ lễ";
/** Tuần đi lễ được đánh dấu "không có lễ" (khác với buổi học nghỉ lễ). */
export const MASS_CANCELLED = "Tuần này đã được đánh dấu không có lễ";
/** Thông điệp từ chối ghi vào một buổi đã huỷ, theo loại buổi. */
export const cancelledMessage = (kind: SessionKind): string => (kind === "mass" ? MASS_CANCELLED : CANCELLED);
export const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";
const STATUSES = ["present", "absent_excused", "absent_unexcused", "late"] as const;

export interface Board {
  sessionId: string;
  classId: string;
  heldOn: string;
  cancelled: boolean;
  canWrite: boolean;
  students: BoardStudent[];
  plan: { layout: Layout; assignments: Assignment[] } | null;
}

type Session = typeof sessions.$inferSelect;
export const NO_LATE_AT_MASS = "Buổi đi lễ không có trạng thái đi muộn";

/** Kiểm tra chung trước khi mở một buổi: dữ liệu, quyền ghi (GLV được phân công), ngày không ở tương lai (giờ Việt Nam). */
export async function checkOpenInput(
  db: Db, user: AppUser, input: unknown, now: Date,
): Promise<ActionResult<{ classId: string; heldOn: string; manual: boolean }>> {
  const p = z.object({ classId: z.string(), heldOn: z.iso.date("Ngày không hợp lệ"), manual: z.boolean().optional() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await guardClass(db, user, p.data.classId, "write"))) return fail(NOT_FOUND);
  if (p.data.heldOn > todayInVietnam(now)) return fail("Không thể điểm danh cho ngày chưa tới"); // YYYY-MM-DD so sánh được theo chuỗi
  return ok({ classId: p.data.classId, heldOn: p.data.heldOn, manual: p.data.manual === true });
}

/**
 * Mở (hoặc lấy lại) buổi `kind` của lớp ngày `heldOn` SAU khi đã kiểm tra quyền: idempotent nhờ khoá duy nhất
 * (class_id, held_on, kind). Học kỳ là học kỳ chứa ngày đầu tiên trong `termOn` có học kỳ.
 */
export async function openCheckedSession(
  db: Db, classId: string, heldOn: string, kind: SessionKind, termOn: readonly string[],
): Promise<ActionResult<Session>> {
  const cls = await getClassById(db, classId);
  if (!cls) return fail(NOT_FOUND);
  let term: { id: string } | null = null;
  for (const day of termOn) {
    term = await findTermFor(db, day, cls.schoolYearId);
    if (term) break;
  }
  if (!term) return fail("Ngày này không thuộc học kỳ nào");
  await db.insert(sessions).values({ classId, termId: term.id, heldOn, kind })
    .onConflictDoNothing({ target: [sessions.classId, sessions.heldOn, sessions.kind] });
  const session = await findSession(db, classId, heldOn, kind);
  return session ? ok(session) : fail(NOT_FOUND_SESSION);
}

/** Mở (hoặc lấy lại) buổi `kind` của lớp trong ngày. Chỉ người có quyền ghi. */
export async function openSessionOfKind(
  db: Db, user: AppUser, input: unknown, kind: SessionKind, now: Date = new Date(),
): Promise<ActionResult<{ id: string }>> {
  const checked = await checkOpenInput(db, user, input, now);
  if (!checked.ok) return checked;
  const opened = await openCheckedSession(db, checked.data.classId, checked.data.heldOn, kind, [checked.data.heldOn]);
  return opened.ok ? ok({ id: opened.data.id }) : opened;
}

/** Buổi học giáo lý (kind = 'class'). */
export function openSession(db: Db, user: AppUser, input: unknown, now: Date = new Date()): Promise<ActionResult<{ id: string }>> {
  return openSessionOfKind(db, user, input, "class", now);
}

async function loadWritableSession(db: Db, user: AppUser, sessionId: string) {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || !(await guardClass(db, user, session.classId, "write"))) return null;
  return session;
}

export async function setStatus(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ warning: WarningResult }>> {
  const p = z.object({
    sessionId: z.string(),
    studentId: z.string(),
    status: z.enum(STATUSES).nullable(),
    reason: z.string().trim().max(200, "Lý do tối đa 200 ký tự").nullable(),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  const written = await writeManualMark(db, user, session, p.data.studentId, p.data.status, p.data.reason || null);
  if (!written.ok) return written;
  return ok({ warning: evaluateWarningFromCount(await unexcusedCount(db, written.data.studentId, session.termId)) });
}

type StudentRow = NonNullable<Awaited<ReturnType<typeof getStudent>>>;
type Mark = { status: AttendanceStatus; reason: string | null };

const sameMark = (a: Mark | null, b: Mark | null) => a?.status === b?.status && a?.reason === b?.reason;
const auditMark = (m: Mark | null) => (m ? { status: m.status, reason: m.reason === null ? null : redactText(m.reason) } : null);
/** Phần chung của `summary` cho mọi sự kiện gắn với một buổi. */
const sessionFacts = (session: Session) => ({ sessionId: session.id, sessionDate: session.heldOn, sessionKind: session.kind });

/**
 * Ghi tay (chạm trên bảng) trạng thái của một em trong buổi; `null` = xoá dòng. Ghi đè dòng hiện có và đặt
 * `lastEventId = null`, nên hoàn tác của lượt quét / lần "Tất cả có mặt" cũ không còn xoá được dòng này.
 * Buổi đi lễ không có "đi muộn". Người gọi đã kiểm tra quyền ghi của buổi. Người gọi đã đọc em rồi thì truyền luôn
 * bản ghi đó (khỏi đọc lại); vẫn kiểm tra em thuộc lớp của buổi và đang hoạt động.
 *
 * Nhật ký `attendance.set`: chỉ khi trạng thái/lý do thật sự đổi; ghi cùng MỘT câu lệnh với thay đổi (`writeWithAudit`),
 * nên không thêm lượt khứ hồi. Chạm lại đúng trạng thái cũ vẫn ghi (đặt lại `lastEventId`) nhưng không có nhật ký.
 */
export async function writeManualMark(
  db: Db, user: AppUser, session: Session, who: string | StudentRow, status: AttendanceStatus | null, reason: string | null,
): Promise<ActionResult<{ studentId: string }>> {
  if (session.cancelled) return fail(cancelledMessage(session.kind));
  if (session.kind === "mass" && status === "late") return fail(NO_LATE_AT_MASS);
  const loaded = typeof who === "string"
    ? (z.uuid().safeParse(who).success ? await getStudentWithMark(db, who, session.id) : null)
    : { student: who, mark: await getMark(db, session.id, who.id) };
  const student = loaded?.student;
  if (!loaded || !student || student.classId !== session.classId || !student.active) return fail(NOT_FOUND_STUDENT);

  const after: Mark | null = status === null ? null : { status, reason };
  const write = status === null
    ? db.delete(attendance).where(and(eq(attendance.sessionId, session.id), eq(attendance.studentId, student.id)))
      .returning({ id: attendance.studentId })
    : db.insert(attendance)
      .values({ sessionId: session.id, studentId: student.id, status, reason, updatedBy: user.id, updatedAt: new Date(), lastEventId: null })
      .onConflictDoUpdate({
        target: [attendance.sessionId, attendance.studentId],
        set: { status, reason, updatedBy: user.id, updatedAt: new Date(), lastEventId: null },
      })
      .returning({ id: attendance.studentId });
  if (sameMark(loaded.mark, after)) {
    await write;
  } else {
    await writeWithAudit(db, write, {
      actorId: user.id, classId: session.classId, entity: "attendance", entityId: student.id, action: "attendance.set",
      summary: { studentName: redactText(student.fullName), ...sessionFacts(session), before: auditMark(loaded.mark), after: auditMark(after) },
    });
  }
  return ok({ studentId: student.id });
}

/**
 * Chèn một dòng `status` cho mọi em đang hoạt động của lớp CHƯA có dòng trong buổi (không đụng dòng có sẵn;
 * `onConflictDoNothing` để hai thiết bị cùng bấm không ghi chồng). Trả về id các em vừa được ghi. Có em được ghi thì
 * chèn đúng một dòng nhật ký `audit(số em)` trong cùng transaction.
 */
async function fillUnmarked(
  db: Db, user: AppUser, session: Session,
  status: "present" | "absent_unexcused", lastEventId: string | null, audit: (count: number) => AuditEvent,
): Promise<string[]> {
  const roster = await db.select({ id: students.id }).from(students)
    .where(and(eq(students.classId, session.classId), eq(students.active, true)));
  const markedIds = new Set(
    (await db.select({ id: attendance.studentId }).from(attendance).where(eq(attendance.sessionId, session.id))).map((m) => m.id),
  );
  const missing = roster.filter((s) => !markedIds.has(s.id));
  if (missing.length === 0) return [];
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(attendance)
      .values(missing.map((m) => ({ sessionId: session.id, studentId: m.id, status, updatedBy: user.id, lastEventId })))
      .onConflictDoNothing()
      .returning({ id: attendance.studentId });
    if (inserted.length > 0) await recordAudit(tx, audit(inserted.length)); // một dòng tổng hợp cho cả lần bấm
    return inserted.map((r) => r.id);
  });
}

/**
 * Điền "có mặt" cho các em chưa có dấu. Mọi dòng của một lần bấm mang chung `lastEventId = batchId`
 * để hoàn tác đúng các dòng đó (dòng bị sửa sau đó có `lastEventId` khác nên không bị xoá).
 */
export async function markAllPresent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ marked: number; batchId: string; studentIds: string[] }>> {
  const p = z.object({ sessionId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  return presentBatch(db, user, session);
}

/** "Có mặt"/"đi lễ" cho các em chưa có dấu của `session` (đã kiểm tra quyền), gắn chung một `batchId` để hoàn tác. */
export async function presentBatch(db: Db, user: AppUser, session: Session): Promise<ActionResult<{ marked: number; batchId: string; studentIds: string[] }>> {
  if (session.cancelled) return fail(cancelledMessage(session.kind));
  const batchId = crypto.randomUUID();
  const studentIds = await fillUnmarked(db, user, session, "present", batchId, (count) => ({
    actorId: user.id, classId: session.classId, entity: "attendance", entityId: session.id, action: "attendance.bulk_present",
    summary: { count, batchId, ...sessionFacts(session) },
  }));
  return ok({ marked: studentIds.length, batchId, studentIds });
}

/** Hoàn tác một lần "Tất cả có mặt": xoá các dòng vẫn còn nguyên từ lần đó; trả về id các em đã xoá. */
export async function undoMarkAllPresent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ studentIds: string[] }>> {
  const p = z.object({ sessionId: z.string(), batchId: z.uuid("Không hoàn tác được") }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  return undoPresentBatch(db, user, session, p.data.batchId);
}

/**
 * Xoá các dòng của `session` vẫn còn nguyên từ lần `batchId` (compare-and-set theo `lastEventId` + `present`):
 * dòng đã bị sửa sau đó (thiết bị khác, quét, chạm tay) giữ kết quả mới hơn.
 */
export async function undoPresentBatch(
  db: Db, user: AppUser, session: Session, batchId: string,
): Promise<ActionResult<{ studentIds: string[] }>> {
  if (session.cancelled) return fail(cancelledMessage(session.kind));
  const removed = await db.transaction(async (tx) => {
    const rows = await tx.delete(attendance)
      .where(and(eq(attendance.sessionId, session.id), eq(attendance.lastEventId, batchId), eq(attendance.status, "present")))
      .returning({ id: attendance.studentId });
    if (rows.length > 0) {
      await recordAudit(tx, {
        actorId: user.id, classId: session.classId, entity: "attendance", entityId: session.id, action: "attendance.bulk_undo",
        summary: { count: rows.length, batchId, ...sessionFacts(session) },
      });
    }
    return rows;
  });
  return ok({ studentIds: removed.map((r) => r.id) });
}

/**
 * Kết thúc buổi: ghi "vắng không phép" cho các em đang hoạt động CHƯA có dòng điểm danh. Không đụng dòng có sẵn
 * (có mặt/đi muộn/có phép) nên idempotent và an toàn khi hai thiết bị cùng bấm. `lastEventId` để null: dòng này không
 * thuộc lượt quét hay lần "Tất cả có mặt" nào, nên hoàn tác của hai thao tác kia không bao giờ xoá nhầm; muốn sửa thì đổi
 * trạng thái từng em (ví dụ "có phép").
 */
export async function markRemainingAbsent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ marked: number; studentIds: string[] }>> {
  const p = z.object({ sessionId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  // Buổi đi lễ: "chưa hỏi" = không có dòng, không bao giờ tự điền vắng.
  if (!session || session.kind !== "class") return fail(NOT_FOUND_SESSION);
  if (session.cancelled) return fail(CANCELLED);
  const studentIds = await fillUnmarked(db, user, session, "absent_unexcused", null, (count) => ({
    actorId: user.id, classId: session.classId, entity: "attendance", entityId: session.id, action: "attendance.remaining_absent",
    summary: { count, ...sessionFacts(session) },
  }));
  return ok({ marked: studentIds.length, studentIds });
}

export async function setCancelled(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ sessionId: z.string(), cancelled: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const session = await loadWritableSession(db, user, p.data.sessionId);
  if (!session) return fail(NOT_FOUND_SESSION);
  const { cancelled } = p.data;
  if (session.cancelled === cancelled) return ok(undefined); // không đổi gì: không ghi, không nhật ký
  // Điều kiện `cancelled <> mới` trong cùng câu lệnh: hai thiết bị cùng bấm thì chỉ một lần đổi (và một dòng nhật ký).
  await writeWithAudit(db, db.update(sessions).set({ cancelled })
    .where(and(eq(sessions.id, session.id), ne(sessions.cancelled, cancelled))).returning({ id: sessions.id }), {
    actorId: user.id, classId: session.classId, entity: "session", entityId: session.id,
    action: cancelled ? "session.cancel" : "session.reopen",
    summary: { sessionDate: session.heldOn, sessionKind: session.kind },
  });
  return ok(undefined);
}

export async function readBoard(db: Db, user: AppUser, sessionId: string): Promise<Board | null> {
  if (!z.uuid().safeParse(sessionId).success) return null;
  const session = await getSession(db, sessionId);
  if (!session || session.kind !== "class") return null; // bảng điểm danh buổi học; buổi đi lễ có màn riêng
  const perms = await classPermissions(db, user, session.classId);
  if (!perms.canRead) return null;
  const data = await loadBoardData(db, session);
  return {
    sessionId: session.id,
    classId: session.classId,
    heldOn: session.heldOn,
    cancelled: session.cancelled,
    canWrite: perms.canWrite,
    ...data,
  };
}
