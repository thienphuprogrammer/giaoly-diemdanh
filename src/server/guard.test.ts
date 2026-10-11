import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { classPermissions, guardClass } from "./guard";

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

describe("guardClass for a grade head", () => {
  it("can read but not write own-grade classes, and cannot read other grades", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect((await guardClass(db, b.head, b.classId, "read"))?.id).toBe(b.classId);
    expect(await guardClass(db, b.head, b.classId, "write")).toBeNull();
    expect(await guardClass(db, b.head, b.otherClassId, "read")).toBeNull();
  });
});

describe("classPermissions", () => {
  it("gives a head read-only access and an assigned catechist full access", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await classPermissions(db, b.head, b.classId)).toEqual({ canRead: true, canWrite: false });
    expect(await classPermissions(db, b.glv, b.classId)).toEqual({ canRead: true, canWrite: true });
    expect(await classPermissions(db, b.otherGlv, b.classId)).toEqual({ canRead: false, canWrite: false });
    expect(await classPermissions(db, b.head, b.otherClassId)).toEqual({ canRead: false, canWrite: false });
  });
});
