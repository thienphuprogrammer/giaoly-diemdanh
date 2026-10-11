import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { guardClass } from "./guard";

describe("guardClass", () => {
  it("returns the class for an assigned catechist", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect((await guardClass(db, b.glv, b.classId, "write"))?.id).toBe(b.classId);
  });

  it("returns null for another grade's class (no existence leak)", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await guardClass(db, b.glv, b.otherClassId, "read")).toBeNull();
  });

  it("returns null for unknown or malformed ids", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await guardClass(db, b.glv, "00000000-0000-4000-8000-000000000000", "read")).toBeNull();
    expect(await guardClass(db, b.glv, "not-a-uuid", "read")).toBeNull();
  });

  it("denies immediately after the catechist is removed from the class", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    await db.delete(classCatechists).where(eq(classCatechists.userId, b.glv.id));
    expect(await guardClass(db, b.glv, b.classId, "read")).toBeNull();
  });
});
