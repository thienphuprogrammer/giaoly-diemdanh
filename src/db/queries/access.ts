import { eq } from "drizzle-orm";
import type { AccessClass } from "@/lib/access/can-access";
import { classCatechists, classes } from "../schema";
import type { Db } from "../types";

export async function getAccessClass(db: Db, classId: string): Promise<AccessClass | null> {
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) return null;
  const rows = await db
    .select({ userId: classCatechists.userId })
    .from(classCatechists)
    .where(eq(classCatechists.classId, classId));
  return { id: cls.id, gradeId: cls.gradeId, schoolYearId: cls.schoolYearId, catechistIds: rows.map((r) => r.userId) };
}
