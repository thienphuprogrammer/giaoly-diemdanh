import { eq } from "drizzle-orm";
import { z } from "zod";
import { getPlan, replaceAssignments } from "@/db/queries/seating";
import { getStudent } from "@/db/queries/students";
import { seatingPlans } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { assignStudent, pruneAssignments, unassignSeat } from "@/lib/seating/assignments";
import { defaultLayout, parseLayout } from "@/lib/seating/layout";
import type { Assignment, Layout } from "@/lib/seating/types";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const NOT_FOUND_PLAN = "Không tìm thấy sơ đồ";
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";

async function loadWritablePlan(db: Db, user: AppUser, planId: string) {
  if (!z.uuid().safeParse(planId).success) return null;
  const data = await getPlan(db, planId);
  if (!data || !(await guardClass(db, user, data.plan.classId, "write"))) return null;
  return data;
}

export async function createPlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ classId: z.string(), name: z.string().trim().min(1, "Nhập tên sơ đồ").max(60) }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await guardClass(db, user, p.data.classId, "write"))) return fail(NOT_FOUND);
  const existing = await db.select({ id: seatingPlans.id }).from(seatingPlans).where(eq(seatingPlans.classId, p.data.classId));
  const [row] = await db
    .insert(seatingPlans)
    .values({ classId: p.data.classId, name: p.data.name, layout: defaultLayout(() => crypto.randomUUID()), isActive: existing.length === 0 })
    .returning({ id: seatingPlans.id });
  return ok({ id: row.id });
}

export async function saveLayout(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ layout: Layout; assignments: Assignment[] }>> {
  const p = z.object({ planId: z.string(), layout: z.unknown() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const parsed = parseLayout(p.data.layout);
  if (!parsed.ok) return fail(parsed.error);
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const kept = pruneAssignments(parsed.layout, data.assignments);
  await db.transaction(async (tx) => {
    await tx.update(seatingPlans).set({ layout: parsed.layout }).where(eq(seatingPlans.id, data.plan.id));
    await replaceAssignments(tx, data.plan.id, kept);
  });
  return ok({ layout: parsed.layout, assignments: kept });
}

export async function assignSeat(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ assignments: Assignment[] }>> {
  const p = z.object({
    planId: z.string(),
    benchId: z.string().min(1),
    seatIndex: z.number().int().min(0),
    studentId: z.string().nullable(),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const seat = { benchId: p.data.benchId, seatIndex: p.data.seatIndex };

  let next: Assignment[];
  if (p.data.studentId === null) {
    next = unassignSeat(data.assignments, seat);
  } else {
    if (!z.uuid().safeParse(p.data.studentId).success) return fail("Không thể xếp em này");
    const student = await getStudent(db, p.data.studentId);
    if (!student || student.classId !== data.plan.classId || !student.active) return fail("Không thể xếp em này");
    const result = assignStudent(data.plan.layout, data.assignments, seat, student.id);
    if (!result.ok) return fail(result.error);
    next = result.assignments;
  }
  await db.transaction((tx) => replaceAssignments(tx, data.plan.id, next));
  return ok({ assignments: next });
}

export async function activatePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  await db.transaction(async (tx) => {
    await tx.update(seatingPlans).set({ isActive: false }).where(eq(seatingPlans.classId, data.plan.classId));
    await tx.update(seatingPlans).set({ isActive: true }).where(eq(seatingPlans.id, data.plan.id));
  });
  return ok(undefined);
}

export async function deletePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  if (data.plan.isActive) return fail("Không thể xóa sơ đồ đang dùng");
  await db.delete(seatingPlans).where(eq(seatingPlans.id, data.plan.id));
  return ok(undefined);
}
