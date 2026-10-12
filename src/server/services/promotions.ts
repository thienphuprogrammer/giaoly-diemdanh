import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classesWithCountsOfGrades, findPromotionByToken, getPromotion, getPromotionClass, hasLaterPromotion, listGradePromotions, recentNextGradeEvents, type PromotionClass } from "@/db/queries/promotions";
import { getGrade } from "@/db/queries/grades";
import { promotions, seatAssignments, seatingPlans, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { describeAuditEvent } from "@/lib/audit/describe";
import { redactText } from "@/lib/audit/events";
import { MAX_PROMOTION, STALE_PROMOTION } from "@/lib/promotion";
import { recordAudit } from "../audit";
import { NOT_FOUND } from "../guard";
import { fail, ok, type ActionResult } from "../result";

/**
 * Lên lớp (spec §3, quyết định đã chốt: CHUYỂN em). Đổi `students.class_id` sang lớp đích: thẻ QR (`qr_token`) giữ nguyên,
 * dòng điểm danh cũ vẫn gắn với buổi của lớp cũ (hồ sơ em tra theo `student_id`). Chỗ ngồi của em ở lớp cũ bị xoá.
 *
 * Quyền: chỉ trưởng khối của khối lớp NGUỒN (`canManageGrade`); lớp đích phải cùng khối hoặc thuộc khối kế tiếp
 * (`grades.next_grade_id` của khối nguồn). Mọi trường hợp ngoài quyền trả về như lớp không tồn tại.
 */

export const PROMOTION_NOT_FOUND = "Không tìm thấy lượt lên lớp";
const STALE = STALE_PROMOTION;
const UNIQUE_VIOLATION = "23505";

const isUniqueViolation = (e: unknown): boolean => {
  const code = (x: unknown) => (typeof x === "object" && x !== null ? (x as { code?: unknown }).code : undefined);
  return code(e) === UNIQUE_VIOLATION || code((e as { cause?: unknown } | null)?.cause) === UNIQUE_VIOLATION;
};

const pairInput = z.object({ fromClassId: z.string(), toClassId: z.string() });
const applyInput = pairInput.extend({
  studentIds: z.array(z.uuid("Danh sách em không hợp lệ"), "Danh sách em không hợp lệ")
    .min(1, "Chọn ít nhất một em")
    .max(MAX_PROMOTION, `Mỗi lần chuyển tối đa ${MAX_PROMOTION} em`),
  clientToken: z.uuid("Yêu cầu không hợp lệ").optional(),
});

interface Pair { from: PromotionClass; to: PromotionClass }

/** Lớp nguồn trong khối của trưởng khối, lớp đích cùng khối hoặc ở khối kế tiếp, hai lớp khác nhau; null nếu không. */
async function loadPair(db: Db, user: AppUser, fromClassId: string, toClassId: string): Promise<Pair | null> {
  if (!z.uuid().safeParse(fromClassId).success || !z.uuid().safeParse(toClassId).success || fromClassId === toClassId) return null;
  const [from, to] = await Promise.all([getPromotionClass(db, fromClassId), getPromotionClass(db, toClassId)]);
  if (!from || !to || !canManageGrade(user, from.gradeId)) return null;
  const reachable = to.gradeId === from.gradeId || (from.nextGradeId !== null && to.gradeId === from.nextGradeId);
  return reachable ? { from, to } : null;
}

export interface PromotionTargets {
  sources: { id: string; name: string; activeCount: number }[];
  targets: { id: string; name: string; gradeId: string; gradeName: string; sameGrade: boolean }[];
  nextGrade: { id: string; name: string } | null;
}

/** Lớp nguồn (lớp của khối mình) và lớp đích được phép (cùng khối + khối kế tiếp). null nếu không phải trưởng khối. */
export async function promotionTargets(db: Db, user: AppUser): Promise<PromotionTargets | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const grade = await getGrade(db, user.gradeId);
  if (!grade) return null;
  const next = grade.nextGradeId ? await getGrade(db, grade.nextGradeId) : null;
  const rows = await classesWithCountsOfGrades(db, next ? [grade.id, next.id] : [grade.id]);
  const own = rows.filter((c) => c.gradeId === grade.id);
  return {
    sources: own.map((c) => ({ id: c.id, name: c.name, activeCount: Number(c.activeCount) })),
    targets: [...own, ...rows.filter((c) => c.gradeId !== grade.id)].map((c) => ({
      id: c.id, name: c.name, gradeId: c.gradeId, gradeName: c.gradeName, sameGrade: c.gradeId === grade.id,
    })),
    nextGrade: next ? { id: next.id, name: next.name } : null,
  };
}

export interface PromotionPreview {
  from: { id: string; name: string };
  to: { id: string; name: string; gradeName: string };
  /** Em đang học ở lớp nguồn (em đã nghỉ không có ở đây, ở lại lớp cũ); mặc định chọn tất cả. */
  students: { id: string; fullName: string; saintName: string | null; selected: boolean }[];
}

export async function previewPromotion(db: Db, user: AppUser, input: unknown): Promise<ActionResult<PromotionPreview>> {
  const p = pairInput.safeParse(input);
  if (!p.success) return fail(NOT_FOUND);
  const pair = await loadPair(db, user, p.data.fromClassId, p.data.toClassId);
  if (!pair) return fail(NOT_FOUND);
  const rows = await db.select({ id: students.id, fullName: students.fullName, saintName: students.saintName })
    .from(students)
    .where(and(eq(students.classId, pair.from.id), eq(students.active, true)))
    .orderBy(asc(students.fullName));
  return ok({
    from: { id: pair.from.id, name: pair.from.name },
    to: { id: pair.to.id, name: pair.to.name, gradeName: pair.to.gradeName },
    students: [...rows].sort((a, b) => a.fullName.localeCompare(b.fullName, "vi")).map((s) => ({ ...s, selected: true })),
  });
}

export interface PromotionResult {
  /** null khi không còn em nào để chuyển (mọi em đã ở lớp đích). */
  promotionId: string | null;
  moved: number;
  skipped: number;
  seatsRemoved: number;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Seat = { planId: string; benchId: string; seatIndex: number; studentId: string };

/** Xoá chỗ ngồi của các em trong mọi sơ đồ của một lớp; trả về các chỗ đã xoá. */
async function clearSeats(tx: Tx, classId: string, studentIds: string[]): Promise<Seat[]> {
  if (studentIds.length === 0) return [];
  return tx.delete(seatAssignments)
    .where(and(
      inArray(seatAssignments.studentId, studentIds),
      inArray(seatAssignments.planId, tx.select({ id: seatingPlans.id }).from(seatingPlans).where(eq(seatingPlans.classId, classId))),
    ))
    .returning({ planId: seatAssignments.planId, benchId: seatAssignments.benchId, seatIndex: seatAssignments.seatIndex, studentId: seatAssignments.studentId });
}

/** Kết quả của lượt đã ghi với cùng `clientToken` (bấm hai lần / gửi lại). */
async function replay(db: Db | Tx, user: AppUser, pair: Pair, clientToken: string | undefined, requested: number): Promise<ActionResult<PromotionResult> | null> {
  if (!clientToken) return null;
  const prev = await findPromotionByToken(db, user.id, clientToken);
  if (!prev) return null;
  if (prev.fromClassId !== pair.from.id || prev.toClassId !== pair.to.id) return fail("Yêu cầu không hợp lệ");
  const moved = prev.studentIds.length;
  return ok({ promotionId: prev.id, moved, skipped: Math.max(0, requested - moved), seatsRemoved: prev.removedSeats.length });
}

async function movePromotion(tx: Tx, user: AppUser, pair: Pair, ids: string[], clientToken: string | undefined): Promise<ActionResult<PromotionResult>> {
  const rows = await tx.select({ id: students.id, classId: students.classId, active: students.active })
    .from(students).where(inArray(students.id, ids)).for("update");
  const inTarget = rows.filter((s) => s.classId === pair.to.id);
  const movable = rows.filter((s) => s.classId === pair.from.id && s.active);
  if (inTarget.length + movable.length !== ids.length) return fail(STALE);
  if (movable.length === 0) {
    // Hai lần gửi cùng mã chạy song song: lần sau chờ khoá dòng của lần trước, thấy mọi em đã ở lớp đích => trả lại kết quả lần trước.
    const previous = await replay(tx, user, pair, clientToken, ids.length);
    return previous ?? ok({ promotionId: null, moved: 0, skipped: inTarget.length, seatsRemoved: 0 });
  }

  const moved = await tx.update(students).set({ classId: pair.to.id })
    .where(and(inArray(students.id, movable.map((s) => s.id)), eq(students.classId, pair.from.id), eq(students.active, true)))
    .returning({ id: students.id });
  const movedIds = moved.map((s) => s.id);
  const removedSeats = await clearSeats(tx, pair.from.id, movedIds);
  const [promo] = await tx.insert(promotions).values({
    actorId: user.id, fromClassId: pair.from.id, toClassId: pair.to.id, studentIds: movedIds, removedSeats, clientToken: clientToken ?? null,
  }).returning({ id: promotions.id });
  const names = { fromClass: redactText(pair.from.name), toClass: redactText(pair.to.name) };
  const base = { actorId: user.id, entity: "promotion" as const, entityId: promo.id, action: "promotion.apply" as const };
  // Một dòng cho mỗi lớp liên quan: lớp cũ (chi tiết) và lớp mới ("chuyển vào"), để Nhật ký của cả hai lớp đều thấy.
  await recordAudit(tx, { ...base, classId: pair.from.id, gradeId: pair.from.gradeId,
    summary: { ...names, count: movedIds.length, skipped: inTarget.length, seatsRemoved: removedSeats.length } });
  await recordAudit(tx, { ...base, classId: pair.to.id, gradeId: pair.to.gradeId, summary: { ...names, count: movedIds.length, direction: "in" } });
  return ok({ promotionId: promo.id, moved: movedIds.length, skipped: inTarget.length, seatsRemoved: removedSeats.length });
}

/**
 * Chuyển các em đã chọn sang lớp đích trong MỘT transaction: đổi `class_id` (CAS theo lớp nguồn), xoá chỗ ngồi của em ở
 * các sơ đồ của lớp cũ, lưu bản ghi hoàn tác và đúng một dòng nhật ký. Em đã ở lớp đích được bỏ qua (gửi lại an toàn);
 * em đã nghỉ hoặc ở lớp khác => từ chối cả lượt. Cùng `clientToken` => trả lại kết quả lần đầu.
 */
export async function applyPromotion(db: Db, user: AppUser, input: unknown): Promise<ActionResult<PromotionResult>> {
  const p = applyInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
  const pair = await loadPair(db, user, p.data.fromClassId, p.data.toClassId);
  if (!pair) return fail(NOT_FOUND);
  const ids = [...new Set(p.data.studentIds)];
  const { clientToken } = p.data;
  const previous = await replay(db, user, pair, clientToken, ids.length);
  if (previous) return previous;
  try {
    return await db.transaction((tx) => movePromotion(tx, user, pair, ids, clientToken));
  } catch (error) {
    // Hai lần gửi cùng mã chạy song song: lần sau vấp ràng buộc duy nhất, trả về kết quả của lần trước.
    if (isUniqueViolation(error)) {
      const again = await replay(db, user, pair, clientToken, ids.length);
      if (again) return again;
    }
    throw error;
  }
}

const ALREADY_UNDONE = "Lượt lên lớp này đã được hoàn tác";
const LATER = "Có em trong lượt này đã được chuyển tiếp ở một lượt lên lớp sau. Hãy hoàn tác lượt sau trước.";
const EXPIRED = "Đã quá 24 giờ, không hoàn tác được nữa";

/**
 * Hoàn tác trong 24 giờ: chỉ trưởng khối của khối lớp nguồn (người đã chuyển, hoặc trưởng khối khác của cùng khối).
 * Chỉ trả về lớp cũ những em CÒN ở lớp đích (CAS); em đã bị chuyển tiếp thì báo "không trả được". Chỗ ngồi cũ KHÔNG
 * được khôi phục; chỗ ngồi em đã có ở lớp đích bị xoá để không sót em lạ trong sơ đồ lớp đích.
 */
export async function undoPromotion(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ restored: number; notRestored: number }>> {
  const p = z.object({ promotionId: z.uuid() }).safeParse(input);
  if (!p.success) return fail(PROMOTION_NOT_FOUND);
  const promo = await getPromotion(db, p.data.promotionId);
  if (!promo || !canManageGrade(user, promo.fromGradeId)) return fail(PROMOTION_NOT_FOUND);
  if (promo.undoneAt) return fail(ALREADY_UNDONE);
  if (!promo.fresh) return fail(EXPIRED);

  return db.transaction(async (tx) => {
    if (await hasLaterPromotion(tx, promo.id, [...promo.studentIds])) return fail(LATER);
    const [claimed] = await tx.update(promotions).set({ undoneAt: sql`now()`, undoneBy: user.id })
      .where(and(eq(promotions.id, promo.id), sql`${promotions.undoneAt} is null`, sql`${promotions.createdAt} > now() - interval '24 hours'`))
      .returning({ id: promotions.id });
    if (!claimed) return fail(ALREADY_UNDONE);
    const ids = [...promo.studentIds];
    const back = ids.length === 0 ? [] : await tx.update(students).set({ classId: promo.fromClassId })
      .where(and(inArray(students.id, ids), eq(students.classId, promo.toClassId)))
      .returning({ id: students.id });
    await clearSeats(tx, promo.toClassId, back.map((s) => s.id));
    const result = { restored: back.length, notRestored: ids.length - back.length };
    const base = { actorId: user.id, entity: "promotion" as const, entityId: promo.id, action: "promotion.undo" as const };
    const summary = { fromClass: redactText(promo.fromClassName), toClass: redactText(promo.toClassName), ...result };
    await recordAudit(tx, { ...base, classId: promo.fromClassId, gradeId: promo.fromGradeId, summary });
    await recordAudit(tx, { ...base, classId: promo.toClassId, gradeId: promo.toGradeId, summary: { ...summary, direction: "in" } });
    return ok(result);
  });
}

export interface PromotionItem {
  id: string;
  fromClassName: string;
  toClassName: string;
  count: number;
  createdAt: Date;
  actorName: string | null;
  undone: boolean;
  canUndo: boolean;
  /** Lượt từ khối khác chuyển em VÀO lớp của khối này: chỉ xem, trưởng khối đích không hoàn tác được. */
  incoming: boolean;
}

/**
 * 20 lượt lên lớp gần nhất liên quan tới khối: lớp nguồn hoặc lớp đích thuộc khối (lượt từ khối khác chuyển vào hiện ra
 * để trưởng khối đích biết, nhưng chỉ đọc). null nếu không phải trưởng khối.
 */
export async function listPromotions(db: Db, user: AppUser): Promise<PromotionItem[] | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const rows = await listGradePromotions(db, user.gradeId, 20);
  return rows.map((r) => {
    const incoming = r.fromGradeId !== user.gradeId;
    return {
      id: r.id, fromClassName: r.fromClassName, toClassName: r.toClassName, count: r.studentIds.length,
      createdAt: r.createdAt, actorName: r.actorName, undone: r.undoneAt !== null, incoming,
      canUndo: !incoming && r.undoneAt === null && Boolean(r.fresh),
    };
  });
}

/** Số ngày băng báo "khối khác chuyển em vào / chọn khối này làm khối kế tiếp" còn hiện. */
export const INCOMING_DAYS = 7;

export interface IncomingNotices {
  transfers: { id: string; fromGradeName: string; fromClassName: string; toClassName: string; count: number; createdAt: Date; actorName: string | null; undone: boolean }[];
  links: { id: string; at: Date; text: string }[];
}

/**
 * Băng báo trên màn "Năm học" của trưởng khối: trong 7 ngày gần đây, khối khác đã chuyển em vào lớp của khối này, hoặc
 * khối khác đã chọn khối này làm khối kế tiếp. Không có bước đồng ý: chỉ để minh bạch (xem báo cáo Task 36).
 */
export async function incomingNotices(db: Db, user: AppUser): Promise<IncomingNotices | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const [rows, events] = await Promise.all([
    listGradePromotions(db, user.gradeId, 20, { incomingOnly: true, days: INCOMING_DAYS }),
    recentNextGradeEvents(db, user.gradeId, INCOMING_DAYS),
  ]);
  return {
    transfers: rows.map((r) => ({
      id: r.id, fromGradeName: r.fromGradeName, fromClassName: r.fromClassName, toClassName: r.toClassName,
      count: r.studentIds.length, createdAt: r.createdAt, actorName: r.actorName, undone: r.undoneAt !== null,
    })),
    links: events.map((e) => ({ id: e.id, at: e.at, text: describeAuditEvent({ action: e.action, actorName: e.actorName, summary: e.summary }).text })),
  };
}
