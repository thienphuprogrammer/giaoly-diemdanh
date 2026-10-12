import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { classesOfGrades, findPromotionByToken, getPromotion, getPromotionClass, listGradePromotions, type PromotionClass } from "@/db/queries/promotions";
import { getGrade } from "@/db/queries/grades";
import { promotions, seatAssignments, seatingPlans, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
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

export const MAX_PROMOTION = 200;
export const PROMOTION_NOT_FOUND = "Không tìm thấy lượt lên lớp";
const STALE = "Có em không còn ở lớp nguồn hoặc đã nghỉ học. Tải lại danh sách rồi thử lại.";
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
  const rows = await classesOfGrades(db, next ? [grade.id, next.id] : [grade.id]);
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
async function replay(db: Db, user: AppUser, pair: Pair, clientToken: string | undefined, requested: number): Promise<ActionResult<PromotionResult> | null> {
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
  if (movable.length === 0) return ok({ promotionId: null, moved: 0, skipped: inTarget.length, seatsRemoved: 0 });

  const moved = await tx.update(students).set({ classId: pair.to.id })
    .where(and(inArray(students.id, movable.map((s) => s.id)), eq(students.classId, pair.from.id), eq(students.active, true)))
    .returning({ id: students.id });
  const movedIds = moved.map((s) => s.id);
  const removedSeats = await clearSeats(tx, pair.from.id, movedIds);
  const [promo] = await tx.insert(promotions).values({
    actorId: user.id, fromClassId: pair.from.id, toClassId: pair.to.id, studentIds: movedIds, removedSeats, clientToken: clientToken ?? null,
  }).returning({ id: promotions.id });
  await recordAudit(tx, {
    actorId: user.id, classId: pair.from.id, gradeId: pair.from.gradeId, entity: "promotion", entityId: promo.id, action: "promotion.apply",
    summary: {
      fromClass: redactText(pair.from.name), toClass: redactText(pair.to.name),
      count: movedIds.length, skipped: inTarget.length, seatsRemoved: removedSeats.length,
    },
  });
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
    await recordAudit(tx, {
      actorId: user.id, classId: promo.fromClassId, gradeId: promo.fromGradeId, entity: "promotion", entityId: promo.id, action: "promotion.undo",
      summary: { fromClass: redactText(promo.fromClassName), toClass: redactText(promo.toClassName), ...result },
    });
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
}

/** 20 lượt lên lớp gần nhất của khối (theo lớp nguồn). null nếu không phải trưởng khối. */
export async function listPromotions(db: Db, user: AppUser): Promise<PromotionItem[] | null> {
  if (!user.isGradeHead || !user.gradeId) return null;
  const rows = await listGradePromotions(db, user.gradeId, 20);
  return rows.map((r) => ({
    id: r.id, fromClassName: r.fromClassName, toClassName: r.toClassName, count: r.studentIds.length,
    createdAt: r.createdAt, actorName: r.actorName, undone: r.undoneAt !== null, canUndo: r.undoneAt === null && Boolean(r.fresh),
  }));
}
