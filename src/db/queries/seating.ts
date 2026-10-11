import { asc, eq } from "drizzle-orm";
import type { Assignment } from "@/lib/seating/types";
import { seatAssignments, seatingPlans } from "../schema";
import type { Db } from "../types";

export const listPlans = (db: Db, classId: string) =>
  db
    .select({ id: seatingPlans.id, name: seatingPlans.name, isActive: seatingPlans.isActive })
    .from(seatingPlans)
    .where(eq(seatingPlans.classId, classId))
    .orderBy(asc(seatingPlans.name));

export async function getPlan(db: Pick<Db, "select">, planId: string) {
  const [plan] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, planId));
  return plan ? withAssignments(db, plan) : null;
}

/** Khóa dòng sơ đồ (FOR UPDATE) rồi đọc lại sơ đồ và phân ghế; chỉ gọi trong transaction. */
export async function lockPlan(tx: Pick<Db, "select">, planId: string) {
  const [plan] = await tx.select().from(seatingPlans).where(eq(seatingPlans.id, planId)).for("update");
  return plan ? withAssignments(tx, plan) : null;
}

async function withAssignments(db: Pick<Db, "select">, plan: typeof seatingPlans.$inferSelect) {
  const rows = await db.select().from(seatAssignments).where(eq(seatAssignments.planId, plan.id));
  const assignments: Assignment[] = rows.map((r) => ({ benchId: r.benchId, seatIndex: r.seatIndex, studentId: r.studentId }));
  return { plan, assignments };
}

/** Thay toàn bộ phân ghế của một sơ đồ; gọi trong transaction để nguyên tử. */
export async function replaceAssignments(
  db: Pick<Db, "delete" | "insert">,
  planId: string,
  assignments: readonly Assignment[],
): Promise<void> {
  await db.delete(seatAssignments).where(eq(seatAssignments.planId, planId));
  if (assignments.length > 0) await db.insert(seatAssignments).values(assignments.map((a) => ({ planId, ...a })));
}
