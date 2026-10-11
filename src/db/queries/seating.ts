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

export async function getPlan(db: Db, planId: string) {
  const [plan] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, planId));
  if (!plan) return null;
  const rows = await db.select().from(seatAssignments).where(eq(seatAssignments.planId, planId));
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
