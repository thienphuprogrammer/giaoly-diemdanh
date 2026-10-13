import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, classCatechists, classes, grades, loginAttempts, schoolYears, students, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { encryptSession } from "@/lib/auth/session";
import { loadSessionUser } from "@/lib/auth/session-user";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { breakAuditInserts } from "@/test/audit";
import { assignAccountToClass, createAccount, createGrade, createSystemClass, deleteGrade, deleteSystemClass,
  getSystemAdminOverview, resetAccountPassword, setAccountActive, unassignAccountFromClass, updateAccount, updateGrade, updateSystemClass } from "./system-admin";

const PASSWORD = "test-admin-pass-1";
/** The acting admin's own password, required for step-up on credential and privilege changes (M1). */
const ADMIN_PW = "acting-admin-pass-1";
const ADMIN_HASH = hashPassword(ADMIN_PW);
async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [admin] = await db.insert(users).values({ name: "Admin", email: "admin@x.vn", passwordHash: await ADMIN_HASH, isAdmin: true }).returning();
  return { db, b, admin };
}

describe("system administrator boundaries", () => {
  it("rejects both catechists and grade heads for every global operation", async () => {
    const { db, b } = await setup();
    for (const actor of [b.glv, b.head]) {
      const results = await Promise.all([
        getSystemAdminOverview(db, actor), createAccount(db, actor, {}), updateAccount(db, actor, {}), setAccountActive(db, actor, {}),
        resetAccountPassword(db, actor, {}), createGrade(db, actor, {}), updateGrade(db, actor, {}), deleteGrade(db, actor, {}),
        createSystemClass(db, actor, {}), updateSystemClass(db, actor, {}), deleteSystemClass(db, actor, {}),
        assignAccountToClass(db, actor, {}), unassignAccountFromClass(db, actor, {}),
      ]);
      for (const result of results) expect(result).toEqual({ ok: false, error: "Bạn không có quyền thực hiện thao tác này" });
    }
  });

  it("does not trust a stale admin flag after the stored account is disabled or demoted", async () => {
    const { db, admin } = await setup();
    await db.update(users).set({ isActive: false }).where(eq(users.id, admin.id));
    expect((await createGrade(db, admin, { name: "Khối mới" })).ok).toBe(false);
    await db.update(users).set({ isActive: true, isAdmin: false }).where(eq(users.id, admin.id));
    expect((await createGrade(db, admin, { name: "Khối mới" })).ok).toBe(false);
  });
});

describe("global account administration", () => {
  it("creates a head in another grade, resets their password, and returns no credentials", async () => {
    const { db, b, admin } = await setup();
    const result = await createAccount(db, admin, { name: "Trưởng khối khác", email: " NEW@X.VN ", password: PASSWORD, role: "head", gradeId: b.otherGradeId });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("create failed");
    const [head] = await db.select().from(users).where(eq(users.id, result.data.id));
    expect(head).toMatchObject({ email: "new@x.vn", isGradeHead: true, isAdmin: false, gradeId: b.otherGradeId, isActive: true });
    expect(await verifyPassword(PASSWORD, head.passwordHash)).toBe(true);
    expect((await resetAccountPassword(db, admin, { userId: head.id, password: "new-admin-password-2", currentPassword: ADMIN_PW })).ok).toBe(true);
    const [reset] = await db.select().from(users).where(eq(users.id, head.id));
    expect(await verifyPassword("new-admin-password-2", reset.passwordHash)).toBe(true);
    expect(reset.passwordChangedAt).toBeInstanceOf(Date);
    const overview = await getSystemAdminOverview(db, admin);
    expect(overview.ok).toBe(true);
    expect(JSON.stringify(overview)).not.toMatch(/passwordHash|passwordChangedAt|new-admin-password/);
    const audits = await db.select().from(auditEvents);
    expect(audits.map((a) => a.action)).toEqual(["account.create", "account.reset_credentials"]);
    expect(JSON.stringify(audits)).not.toContain(PASSWORD);
    expect(JSON.stringify(audits)).not.toContain(head.passwordHash);
  });

  it("validates role, grade, duplicate email and bcrypt UTF-8 byte limit", async () => {
    const { db, b, admin } = await setup();
    const draft = { name: "GLV", email: "new@x.vn", role: "catechist", password: PASSWORD };
    for (const extra of [{ role: "head" }, { gradeId: crypto.randomUUID() }, { email: b.glv.email }, { password: "ệ".repeat(25) }, { password: "short" }, { role: "unknown" }]) {
      expect((await createAccount(db, admin, { ...draft, ...extra })).ok).toBe(false);
    }
    expect((await createAccount(db, admin, draft)).ok).toBe(true);
    expect((await createAccount(db, admin, { ...draft, email: "second@x.vn", role: "admin", gradeId: b.gradeId, currentPassword: ADMIN_PW })).ok).toBe(true);
    const [createdAdmin] = await db.select().from(users).where(eq(users.email, "second@x.vn"));
    expect(createdAdmin).toMatchObject({ isAdmin: true, isGradeHead: false, gradeId: null });
  });

  it("protects self access and serializes administrator-changing transactions", async () => {
    const { db, b, admin } = await setup();
    expect((await setAccountActive(db, admin, { userId: admin.id, isActive: false })).ok).toBe(false);
    expect((await updateAccount(db, admin, { userId: admin.id, name: admin.name, email: admin.email, role: "head", gradeId: b.gradeId })).ok).toBe(false);
    const [second] = await db.insert(users).values({ email: "other-admin@x.vn", name: "Admin 2", isAdmin: true, passwordHash: "x" }).returning();
    expect((await setAccountActive(db, admin, { userId: second.id, isActive: false, currentPassword: ADMIN_PW })).ok).toBe(true);
    // A request that authenticated before the disable must be refused when it obtains the mutation lock.
    expect((await setAccountActive(db, second, { userId: admin.id, isActive: false, currentPassword: ADMIN_PW })).ok).toBe(false);
    expect((await db.select().from(users).where(eq(users.id, admin.id)))[0].isActive).toBe(true);
    expect((await setAccountActive(db, admin, { userId: second.id, isActive: true, currentPassword: ADMIN_PW })).ok).toBe(true);
  });

  it("updates names, roles and statuses without changing password or stale cross-grade assignments", async () => {
    const { db, b, admin } = await setup();
    const before = b.glv.passwordHash;
    expect((await updateAccount(db, admin, { userId: b.glv.id, name: "Tên mới", email: "new-glv@x.vn", role: "head", gradeId: b.otherGradeId })).ok).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, b.glv.id));
    expect(after).toMatchObject({ name: "Tên mới", email: "new-glv@x.vn", isGradeHead: true, gradeId: b.otherGradeId, passwordHash: before });
    // Class assignments are explicit and remain valid across grade changes; the global admin may assign across grades.
    expect(await db.select().from(classCatechists).where(eq(classCatechists.userId, b.glv.id))).toHaveLength(1);
    expect((await setAccountActive(db, admin, { userId: b.glv.id, isActive: false })).ok).toBe(true);
    expect((await assignAccountToClass(db, admin, { userId: b.glv.id, classId: b.otherClassId })).ok).toBe(false);
  });

  it("rolls account changes back when their audit cannot be recorded", async () => {
    const { db, admin } = await setup();
    await breakAuditInserts(db);
    const result = await createAccount(db, admin, { name: "New", email: "new@x.vn", role: "admin", password: PASSWORD, currentPassword: ADMIN_PW });
    expect(result.ok).toBe(false);
    expect(await db.select().from(users).where(eq(users.email, "new@x.vn"))).toHaveLength(0);
  });

  it("requires a new login after role or grade privileges are changed, while a name edit keeps the session", async () => {
    const { db, b, admin } = await setup();
    const secret = "s".repeat(40);
    const oldCookie = await encryptSession({ userId: b.glv.id, sat: Math.floor(Date.now() / 1000) - 60 }, secret);
    expect((await updateAccount(db, admin, { userId: b.glv.id, name: "Tên mới", email: b.glv.email, role: "catechist", gradeId: b.gradeId })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).not.toBeNull();
    expect((await updateAccount(db, admin, { userId: b.glv.id, name: "Tên mới", email: b.glv.email, role: "head", gradeId: b.otherGradeId })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).toBeNull();
  });

  it("does not revive old sessions when an account is disabled and enabled again", async () => {
    const { db, b, admin } = await setup();
    const secret = "s".repeat(40);
    const oldCookie = await encryptSession({ userId: b.glv.id, sat: Math.floor(Date.now() / 1000) - 60 }, secret);
    expect((await setAccountActive(db, admin, { userId: b.glv.id, isActive: false })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).toBeNull();
    expect((await setAccountActive(db, admin, { userId: b.glv.id, isActive: true })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).toBeNull();
  });
});

describe("step-up re-authentication for credential and privilege changes (M1)", () => {
  const MISSING = "Nhập mật khẩu của bạn để xác nhận thao tác này";
  const WRONG = "Mật khẩu của bạn không đúng";
  const LOCKED = "Nhập sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.";
  const hashOf = async (db: Awaited<ReturnType<typeof setup>>["db"], userId: string) => (await db.select().from(users).where(eq(users.id, userId)))[0].passwordHash;

  it("refuses an admin resetting their own password through the admin path, even with the right current password", async () => {
    const { db, admin } = await setup();
    const before = await hashOf(db, admin.id);
    const result = await resetAccountPassword(db, admin, { userId: admin.id, password: "self-reset-pass-9", currentPassword: ADMIN_PW });
    expect(result).toEqual({ ok: false, error: "Hãy đổi mật khẩu của chính bạn ở trang Tài khoản" });
    expect(await hashOf(db, admin.id)).toBe(before);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("requires the acting admin's correct password to reset another account's password", async () => {
    const { db, b, admin } = await setup();
    const before = await hashOf(db, b.glv.id);
    expect(await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1" })).toEqual({ ok: false, error: MISSING });
    expect(await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: "wrong-password-0" })).toEqual({ ok: false, error: WRONG });
    expect(await hashOf(db, b.glv.id)).toBe(before);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    // Failed step-ups are counted per acting user id, never on any email-keyed login counter.
    expect((await db.select().from(loginAttempts)).map((a) => a.email)).toEqual([`acct:${admin.id}`]);
    expect((await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: ADMIN_PW })).ok).toBe(true);
    expect(await verifyPassword("new-glv-password-1", await hashOf(db, b.glv.id))).toBe(true);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("locks step-up after 5 wrong passwords in 15 minutes, even when the right one follows", async () => {
    const { db, b, admin } = await setup();
    const now = new Date("2026-10-13T08:00:00Z");
    for (let i = 0; i < 5; i++) {
      expect(await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: `wrong-${i}-password` }, now)).toEqual({ ok: false, error: WRONG });
    }
    expect(await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: ADMIN_PW }, now)).toEqual({ ok: false, error: LOCKED });
    const later = new Date(now.getTime() + 16 * 60_000);
    expect((await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: ADMIN_PW }, later)).ok).toBe(true);
  });

  it("requires step-up to create an admin, but not a catechist or grade head", async () => {
    const { db, b, admin } = await setup();
    const draft = { name: "Mới", password: PASSWORD };
    expect(await createAccount(db, admin, { ...draft, email: "a1@x.vn", role: "admin" })).toEqual({ ok: false, error: MISSING });
    expect(await createAccount(db, admin, { ...draft, email: "a1@x.vn", role: "admin", currentPassword: "wrong-password-0" })).toEqual({ ok: false, error: WRONG });
    expect(await db.select().from(users).where(eq(users.email, "a1@x.vn"))).toHaveLength(0);
    expect((await createAccount(db, admin, { ...draft, email: "a1@x.vn", role: "admin", currentPassword: ADMIN_PW })).ok).toBe(true);
    expect((await createAccount(db, admin, { ...draft, email: "c1@x.vn", role: "catechist" })).ok).toBe(true);
    expect((await createAccount(db, admin, { ...draft, email: "h1@x.vn", role: "head", gradeId: b.gradeId })).ok).toBe(true);
  });

  it("requires step-up to grant admin or to demote/edit another admin, but not for ordinary edits", async () => {
    const { db, b, admin } = await setup();
    const promote = { userId: b.glv.id, name: b.glv.name, email: b.glv.email, role: "admin" };
    expect(await updateAccount(db, admin, promote)).toEqual({ ok: false, error: MISSING });
    expect((await db.select().from(users).where(eq(users.id, b.glv.id)))[0].isAdmin).toBe(false);
    expect((await updateAccount(db, admin, { ...promote, currentPassword: ADMIN_PW })).ok).toBe(true);
    const demote = { ...promote, role: "catechist", gradeId: null };
    expect(await updateAccount(db, admin, demote)).toEqual({ ok: false, error: MISSING });
    expect(await updateAccount(db, admin, { ...demote, currentPassword: "wrong-password-0" })).toEqual({ ok: false, error: WRONG });
    expect((await db.select().from(users).where(eq(users.id, b.glv.id)))[0].isAdmin).toBe(true);
    expect((await updateAccount(db, admin, { ...demote, currentPassword: ADMIN_PW })).ok).toBe(true);
    // Ordinary edits of non-admin accounts and the admin's own name need no step-up.
    expect((await updateAccount(db, admin, { ...demote, name: "Tên khác" })).ok).toBe(true);
    expect((await updateAccount(db, admin, { userId: admin.id, name: "Admin mới", email: admin.email, role: "admin" })).ok).toBe(true);
  });

  it("requires step-up to lock or unlock another admin, but not a catechist", async () => {
    const { db, b, admin } = await setup();
    const [other] = await db.insert(users).values({ email: "other-admin@x.vn", name: "Admin 2", isAdmin: true, passwordHash: "x" }).returning();
    expect(await setAccountActive(db, admin, { userId: other.id, isActive: false })).toEqual({ ok: false, error: MISSING });
    expect(await setAccountActive(db, admin, { userId: other.id, isActive: false, currentPassword: "wrong-password-0" })).toEqual({ ok: false, error: WRONG });
    expect((await db.select().from(users).where(eq(users.id, other.id)))[0].isActive).toBe(true);
    expect((await setAccountActive(db, admin, { userId: other.id, isActive: false, currentPassword: ADMIN_PW })).ok).toBe(true);
    expect(await setAccountActive(db, admin, { userId: other.id, isActive: true })).toEqual({ ok: false, error: MISSING });
    expect((await setAccountActive(db, admin, { userId: b.glv.id, isActive: false })).ok).toBe(true);
  });

  it("does not let a stolen session lock the victim out: step-up failures never touch the login counter", async () => {
    const { db, b, admin } = await setup();
    for (let i = 0; i < 6; i++) await resetAccountPassword(db, admin, { userId: b.glv.id, password: "new-glv-password-1", currentPassword: "wrong-password-0" });
    expect(await db.select().from(loginAttempts).where(eq(loginAttempts.email, admin.email))).toHaveLength(0);
  });
});

describe("grades, annual classes and assignments", () => {
  it("creates and edits grades, then only deletes a grade with no references", async () => {
    const { db, b, admin } = await setup();
    const created = await createGrade(db, admin, { name: "Khối mới", massThreshold: 3 });
    if (!created.ok) throw new Error(created.error);
    expect((await updateGrade(db, admin, { gradeId: created.data.id, name: "Khối mới sửa", massThreshold: 4, nextGradeId: b.gradeId })).ok).toBe(true);
    expect((await createGrade(db, admin, { name: "Khối mới sửa" })).ok).toBe(false);
    expect((await deleteGrade(db, admin, { gradeId: b.gradeId })).ok).toBe(false);
    expect((await deleteGrade(db, admin, { gradeId: created.data.id })).ok).toBe(true);
    expect(await db.select().from(grades).where(eq(grades.id, created.data.id))).toHaveLength(0);
  });

  it("keeps the same class name in two years separate and rejects duplicates within one year", async () => {
    const { db, b, admin } = await setup();
    const [year2] = await db.insert(schoolYears).values({ name: "2027-2028" }).returning();
    expect((await createSystemClass(db, admin, { name: b.cls.name, gradeId: b.gradeId, schoolYearId: b.cls.schoolYearId })).ok).toBe(false);
    const result = await createSystemClass(db, admin, { name: b.cls.name, gradeId: b.gradeId, schoolYearId: year2.id });
    if (!result.ok) throw new Error(result.error);
    expect((await updateSystemClass(db, admin, { classId: result.data.id, name: "Lớp sửa", gradeId: b.otherGradeId, schoolYearId: b.cls.schoolYearId })).ok).toBe(true);
    expect((await db.select().from(classes).where(eq(classes.id, result.data.id)))[0].schoolYearId).toBe(year2.id);
    const view = await getSystemAdminOverview(db, admin, { schoolYearId: year2.id });
    if (!view.ok) throw new Error(view.error);
    expect(view.data.classes.map((c) => c.id)).toEqual([result.data.id]);
    expect(view.data.classes[0].schoolYearName).toBe("2027-2028");
  });

  it("assigns across grades idempotently and refuses deletion of classes that carry data", async () => {
    const { db, b, admin } = await setup();
    const draft = { classId: b.otherClassId, userId: b.glv.id };
    expect((await assignAccountToClass(db, admin, draft)).ok).toBe(true);
    expect((await assignAccountToClass(db, admin, draft)).ok).toBe(true);
    expect((await unassignAccountFromClass(db, admin, draft)).ok).toBe(true);
    await db.insert(students).values({ classId: b.classId, fullName: "Em mới" });
    expect((await deleteSystemClass(db, admin, { classId: b.classId })).ok).toBe(false);
    expect((await deleteSystemClass(db, admin, { classId: b.otherClassId })).ok).toBe(false); // audit and assignments retained
    const empty = await createSystemClass(db, admin, { name: "Chưa dùng", gradeId: b.gradeId, schoolYearId: b.cls.schoolYearId });
    if (!empty.ok) throw new Error(empty.error);
    // Creation audit lives at grade scope and survives removing an unused class.
    expect((await deleteSystemClass(db, admin, { classId: empty.data.id })).ok).toBe(true);
    const [unused] = await db.insert(classes).values({ name: "Lớp trống", gradeId: b.gradeId, schoolYearId: b.cls.schoolYearId }).returning();
    expect((await deleteSystemClass(db, admin, { classId: unused.id })).ok).toBe(true);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.entityId, unused.id))).toHaveLength(1);
  });

  it("rejects unsafe identifiers, nonexistent years and malformed overview filters", async () => {
    const { db, b, admin } = await setup();
    expect((await createSystemClass(db, admin, { name: "X", gradeId: b.gradeId, schoolYearId: crypto.randomUUID() })).ok).toBe(false);
    expect((await updateGrade(db, admin, { gradeId: b.gradeId, name: "X", massThreshold: 1, nextGradeId: b.gradeId })).ok).toBe(false);
    expect((await getSystemAdminOverview(db, admin, { schoolYearId: "bad" })).ok).toBe(false);
    expect((await assignAccountToClass(db, admin, { classId: "bad", userId: b.glv.id })).ok).toBe(false);
    const result = await db.execute(sql`select count(*)::int as n from classes`);
    expect(result).toBeDefined();
  });
});
