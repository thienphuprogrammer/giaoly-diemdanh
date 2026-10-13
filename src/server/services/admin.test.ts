import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists, classes, schoolYears, users } from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { encryptSession } from "@/lib/auth/session";
import { passwordChangeSecond } from "@/lib/auth/session-policy";
import { loadSessionUser } from "@/lib/auth/session-user";
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

  it("lets only one of two concurrent creates with the same name succeed", async () => {
    const { db, b } = await setup();
    const results = await Promise.all([createClass(db, b.head, { name: "Lớp Mới" }), createClass(db, b.head, { name: "Lớp Mới" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "Tên lớp đã tồn tại trong khối" });
    expect(await db.select().from(classes).where(eq(classes.name, "Lớp Mới"))).toHaveLength(1);
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

  it("trims the email before validating and stores it lowercased", async () => {
    const { db, b } = await setup();
    expect((await createCatechist(db, b.head, { name: "Lan", email: " Lan@X.vn ", password: VALID_PW })).ok).toBe(true);
    expect(await db.select().from(users).where(eq(users.email, "lan@x.vn"))).toHaveLength(1);
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

  it("refuses a non-head caller, a grade-head target and another grade's target with one message", async () => {
    const { db, b } = await setup();
    const hashOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0].passwordHash;
    const before = { glv: await hashOf(b.glv.id), head: await hashOf(b.head.id), other: await hashOf(b.otherGlv.id) };
    const results = [
      await resetPassword(db, b.glv, { userId: b.glv.id, password: RESET_PW }),
      await resetPassword(db, b.head, { userId: b.head.id, password: RESET_PW }),
      await resetPassword(db, b.head, { userId: b.otherGlv.id, password: RESET_PW }),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, error: "Bạn không có quyền thực hiện thao tác này" });
    expect({ glv: await hashOf(b.glv.id), head: await hashOf(b.head.id), other: await hashOf(b.otherGlv.id) }).toEqual(before);
  });

  it("resets a catechist's password but not another grade's", async () => {
    const { db, b } = await setup();
    expect((await resetPassword(db, b.head, { userId: b.glv.id, password: RESET_PW })).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, b.glv.id));
    expect(await verifyPassword(RESET_PW, row.passwordHash)).toBe(true);
    expect((await resetPassword(db, b.head, { userId: b.otherGlv.id, password: RESET_PW })).ok).toBe(false);
  });
});

describe("resetPassword revokes the target's sessions", () => {
  const SIGNING_KEY = "k".repeat(40);
  const nowS = () => Math.floor(Date.now() / 1000);

  it("signs the catechist out everywhere (sessions from before the reset are rejected) and leaves others alone", async () => {
    const { db, b } = await setup();
    const glvToken = await encryptSession({ userId: b.glv.id, sat: nowS() - 60 }, SIGNING_KEY);
    const headToken = await encryptSession({ userId: b.head.id, sat: nowS() - 60 }, SIGNING_KEY);
    expect(await loadSessionUser(db, glvToken, SIGNING_KEY)).not.toBeNull();

    const at = new Date();
    expect((await resetPassword(db, b.head, { userId: b.glv.id, password: RESET_PW }, at)).ok).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, b.glv.id));
    expect(row.passwordChangedAt).toEqual(passwordChangeSecond(at));
    expect(await loadSessionUser(db, glvToken, SIGNING_KEY)).toBeNull();
    expect(await loadSessionUser(db, headToken, SIGNING_KEY)).not.toBeNull();
    // Đăng nhập lại sau khi đặt lại (sat ≥ mốc đổi) thì hợp lệ.
    expect(await loadSessionUser(db, await encryptSession({ userId: b.glv.id, sat: nowS(), ver: row.sessionVersion }, SIGNING_KEY), SIGNING_KEY)).not.toBeNull();
  });

  it("does not touch password_changed_at when the reset is refused", async () => {
    const { db, b } = await setup();
    await resetPassword(db, b.head, { userId: b.otherGlv.id, password: RESET_PW });
    const [row] = await db.select().from(users).where(eq(users.id, b.otherGlv.id));
    expect(row.passwordChangedAt).toBeNull();
  });
});


describe("head administration respects annual classes and current privileges", () => {
  it("allows the same class name in two years, but rejects duplicates in one year", async () => {
    const { db, b } = await setup();
    const [nextYear] = await db.insert(schoolYears).values({ name: "2027-2028" }).returning();
    expect((await createClass(db, b.head, { name: b.cls.name, schoolYearId: b.yearId })).ok).toBe(false);
    expect((await createClass(db, b.head, { name: b.cls.name, schoolYearId: nextYear.id })).ok).toBe(true);
    expect((await db.select().from(classes).where(eq(classes.name, b.cls.name))).map(c => c.schoolYearId).sort()).toEqual([b.yearId, nextYear.id].sort());
  });

  it("refuses reset or assignment of an admin even if that account has a grade", async () => {
    const { db, b } = await setup();
    const [admin] = await db.insert(users).values({ name: "Admin", email: "admin@x.vn", passwordHash: "unchanged", gradeId: b.gradeId, isAdmin: true }).returning();
    expect((await resetPassword(db, b.head, { userId: admin.id, password: RESET_PW })).ok).toBe(false);
    expect((await assignCatechist(db, b.head, { classId: b.classId, userId: admin.id })).ok).toBe(false);
    expect((await db.select().from(users).where(eq(users.id, admin.id)))[0].passwordHash).toBe("unchanged");
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, admin.id))).toHaveLength(0);
  });

  it("refuses mutations from a previously authenticated head after locking or version change", async () => {
    const { db, b } = await setup();
    await db.update(users).set({ isActive: false }).where(eq(users.id, b.head.id));
    expect((await createClass(db, b.head, { name: "Denied" })).ok).toBe(false);
    await db.update(users).set({ isActive: true, sessionVersion: 1 }).where(eq(users.id, b.head.id));
    expect((await createCatechist(db, b.head, { name: "Denied", email: "denied@x.vn", password: VALID_PW })).ok).toBe(false);
    expect(await db.select().from(users).where(eq(users.email, "denied@x.vn"))).toHaveLength(0);
  });
});
