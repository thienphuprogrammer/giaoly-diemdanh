import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getPlan, lockPlan, replaceAssignments } from "@/db/queries/seating";
import { getStudent } from "@/db/queries/students";
import { seatingPlans } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { assignStudent, pruneAssignments, unassignSeat } from "@/lib/seating/assignments";
import { defaultLayout, parseLayout } from "@/lib/seating/layout";
import type { Assignment, Layout } from "@/lib/seating/types";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const CANNOT_SEAT = "Không thể xếp em này";
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
  const { classId, name } = p.data;
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${classId}))`);
    const existing = await tx.select({ id: seatingPlans.id }).from(seatingPlans).where(eq(seatingPlans.classId, classId));
    const [created] = await tx
      .insert(seatingPlans)
      .values({ classId, name, layout: defaultLayout(() => crypto.randomUUID()), isActive: existing.length === 0 })
      .returning({ id: seatingPlans.id });
    return created;
  });
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
  const saved = await db.transaction(async (tx) => {
    const locked = await lockPlan(tx, data.plan.id);
    if (!locked) return null;
    const kept = pruneAssignments(parsed.layout, locked.assignments);
    await tx.update(seatingPlans).set({ layout: parsed.layout }).where(eq(seatingPlans.id, locked.plan.id));
    await replaceAssignments(tx, locked.plan.id, kept);
    return kept;
  });
  if (!saved) return fail(NOT_FOUND_PLAN);
  return ok({ layout: parsed.layout, assignments: saved });
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
  const studentId = p.data.studentId;
  if (studentId !== null && !z.uuid().safeParse(studentId).success) return fail(CANNOT_SEAT);

  const result = await db.transaction(async (tx): Promise<ActionResult<{ assignments: Assignment[] }>> => {
    const locked = await lockPlan(tx, data.plan.id);
    if (!locked) return fail(NOT_FOUND_PLAN);
    let next: Assignment[];
    if (studentId === null) {
      next = unassignSeat(locked.assignments, seat);
    } else {
      const student = await getStudent(tx, studentId);
      if (!student || student.classId !== locked.plan.classId || !student.active) return fail(CANNOT_SEAT);
      const assigned = assignStudent(locked.plan.layout, locked.assignments, seat, student.id);
      if (!assigned.ok) return fail(assigned.error);
      next = assigned.assignments;
    }
    await replaceAssignments(tx, locked.plan.id, next);
    return ok({ assignments: next });
  });
  return result;
}

export async function activatePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const done = await db.transaction(async (tx) => {
    if (!(await lockPlan(tx, data.plan.id))) return false;
    await tx.update(seatingPlans).set({ isActive: false }).where(eq(seatingPlans.classId, data.plan.classId));
    await tx.update(seatingPlans).set({ isActive: true }).where(eq(seatingPlans.id, data.plan.id));
    return true;
  });
  return done ? ok(undefined) : fail(NOT_FOUND_PLAN);
}

export async function deletePlan(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ planId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const data = await loadWritablePlan(db, user, p.data.planId);
  if (!data) return fail(NOT_FOUND_PLAN);
  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    const locked = await lockPlan(tx, data.plan.id);
    if (!locked) return fail(NOT_FOUND_PLAN);
    if (locked.plan.isActive) return fail("Không thể xóa sơ đồ đang dùng");
    await tx.delete(seatingPlans).where(eq(seatingPlans.id, locked.plan.id));
    return ok(undefined);
  });
  return result;
}
