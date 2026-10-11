import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists, classes, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { assignCatechist, createCatechist, createClass, resetPassword, unassignCatechist } from "./admin";

const VALID_PW = "mat-khau-dai-1";
const RESET_PW = "mat-khau-moi-123";

async function setup() {
  const db = await createTestDb();
  return { db, b: await seedBasics(db) };
}

describe("createClass", () => {
  it("lets the grade head create a class in their grade", async () => {
    const { db, b } = await setup();
    const r = await createClass(db, b.head, { name: "Lớp C" });
    expect(r.ok).toBe(true);
    const rows = await db.select().from(classes).where(eq(classes.gradeId, b.gradeId));
    expect(rows.map((c) => c.name)).toContain("Lớp C");
  });

  it("rejects a plain catechist and duplicate names", async () => {
    const { db, b } = await setup();
    expect((await createClass(db, b.glv, { name: "Lớp C" })).ok).toBe(false);
    expect((await createClass(db, b.head, { name: "Lớp A" })).ok).toBe(false);
  });
});

describe("createCatechist", () => {
  it("creates an account in the head's grade with a hashed password", async () => {
    const { db, b } = await setup();
    const r = await createCatechist(db, b.head, { name: "Cô Lan", email: "Lan@X.vn", password: VALID_PW });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.email, "lan@x.vn"));
    expect(row).toMatchObject({ gradeId: b.gradeId, isGradeHead: false });
    expect(await verifyPassword(VALID_PW, row.passwordHash)).toBe(true);
  });

  it("rejects short passwords, duplicate emails and non-heads", async () => {
    const { db, b } = await setup();
    expect((await createCatechist(db, b.head, { name: "L", email: "l@x.vn", password: "short" })).ok).toBe(false);
    expect((await createCatechist(db, b.head, { name: "L", email: "glv@x.vn", password: VALID_PW })).ok).toBe(false);
    expect((await createCatechist(db, b.glv, { name: "L", email: "l@x.vn", password: VALID_PW })).ok).toBe(false);
  });

  it("rejects passwords longer than 72 characters", async () => {
    const { db, b } = await setup();
    expect((await createCatechist(db, b.head, { name: "L", email: "l@x.vn", password: "a".repeat(73) })).ok).toBe(false);
  });
});

describe("assign / unassign / resetPassword", () => {
  it("assigns a catechist of the same grade and then removes them", async () => {
    const { db, b } = await setup();
    const created = await createCatechist(db, b.head, { name: "Lan", email: "lan@x.vn", password: VALID_PW });
    if (!created.ok) throw new Error("setup");
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true);
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true); // idempotent
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, created.data.id))).toHaveLength(1);
    expect((await unassignCatechist(db, b.head, { classId: b.classId, userId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, created.data.id))).toHaveLength(0);
  });

  it("refuses cross-grade assignment and non-head callers", async () => {
    const { db, b } = await setup();
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: b.otherGlv.id })).ok).toBe(false);
    expect((await assignCatechist(db, b.head, { classId: b.otherClassId, userId: b.glv.id })).ok).toBe(false);
    expect((await assignCatechist(db, b.glv, { classId: b.classId, userId: b.glv.id })).ok).toBe(false);
  });

  it("lets the grade head assign themselves to a class to gain write access", async () => {
    const { db, b } = await setup();
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: b.head.id })).ok).toBe(true);
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, b.head.id))).toHaveLength(1);
  });

  it("resets a catechist's password but not another grade's", async () => {
    const { db, b } = await setup();
    expect((await resetPassword(db, b.head, { userId: b.glv.id, password: RESET_PW })).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, b.glv.id));
    expect(await verifyPassword(RESET_PW, row.passwordHash)).toBe(true);
    expect((await resetPassword(db, b.head, { userId: b.otherGlv.id, password: RESET_PW })).ok).toBe(false);
  });
});
