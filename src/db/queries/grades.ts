import { eq } from "drizzle-orm";
import { grades } from "../schema";
import type { Db } from "../types";

export async function getGrade(db: Pick<Db, "select">, id: string) {
  const [row] = await db.select().from(grades).where(eq(grades.id, id));
  return row ?? null;
}
