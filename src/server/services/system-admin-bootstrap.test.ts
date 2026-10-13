import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bootstrapAdmin } from "./system-admin-bootstrap";
import { auditEvents, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { encryptSession } from "@/lib/auth/session";
import { loadSessionUser } from "@/lib/auth/session-user";
import { breakAuditInserts } from "@/test/audit";
import { createTestDb } from "@/test/db";

describe("operator administrator bootstrap", () => {
  it("creates the first administrator with explicit credentials and a safe global audit", async () => {
    const db = await createTestDb();
    const password = "bootstrap-test-pass-1";
    const result = await bootstrapAdmin(db, { email: " ADMIN@X.VN ", name: "Quản trị", password });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const [admin] = await db.select().from(users).where(eq(users.id, result.data.id));
    expect(admin).toMatchObject({ email: "admin@x.vn", isAdmin: true, isActive: true, isGradeHead: false, gradeId: null });
    expect(await verifyPassword(password, admin.passwordHash)).toBe(true);
    const [event] = await db.select().from(auditEvents);
    expect(event).toMatchObject({ entity: "account", classId: null, gradeId: null, action: "account.create" });
    expect(JSON.stringify({ result, event })).not.toContain(password);
    expect(JSON.stringify({ result, event })).not.toContain(admin.passwordHash);
  });

  it("upgrades an existing account while preserving its password unless explicitly replaced", async () => {
    const db = await createTestDb();
    const oldHash = await hashPassword("old-bootstrap-pass-1");
    const [account] = await db.insert(users).values({ email: "admin@x.vn", name: "GLV", passwordHash: oldHash, isActive: false }).returning();
    expect((await bootstrapAdmin(db, { email: account.email, name: "Admin", promoteExisting: true })).ok).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, account.id));
    expect(after.passwordHash).toBe(oldHash);
    expect(after.isAdmin).toBe(true);
    expect((await bootstrapAdmin(db, { email: account.email, name: "Admin", password: "replacement-pass-2" })).ok).toBe(true);
    const [reset] = await db.select().from(users).where(eq(users.id, account.id));
    expect(await verifyPassword("replacement-pass-2", reset.passwordHash)).toBe(true);
    expect(reset.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("refuses implicit credentials, malformed input, and over-72-byte passwords", async () => {
    const db = await createTestDb();
    for (const input of [
      { email: "new@x.vn", name: "Admin" },
      { email: "bad", name: "Admin", password: "bootstrap-test-pass-1" },
      { email: "new@x.vn", name: "", password: "bootstrap-test-pass-1" },
      { email: "new@x.vn", name: "Admin", password: "ệ".repeat(25) },
    ]) expect((await bootstrapAdmin(db, input)).ok).toBe(false);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("rolls back bootstrapping when the audit fails", async () => {
    const db = await createTestDb();
    await breakAuditInserts(db);
    expect((await bootstrapAdmin(db, { email: "admin@x.vn", name: "Admin", password: "bootstrap-test-pass-1" })).ok).toBe(false);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("revokes an active catechist's old cookies when granting admin while preserving their password", async () => {
    const db = await createTestDb();
    const passwordHash = await hashPassword("existing-glv-pass-1");
    const [account] = await db.insert(users).values({ name: "GLV", email: "upgrade@x.vn", passwordHash }).returning();
    const secret = "s".repeat(40);
    const oldCookie = await encryptSession({ userId: account.id, sat: Math.floor(Date.now() / 1000) - 60 }, secret);
    expect(await loadSessionUser(db, oldCookie, secret)).not.toBeNull();
    expect((await bootstrapAdmin(db, { name: "Admin", email: account.email, promoteExisting: true })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).toBeNull();
    const [updated] = await db.select().from(users).where(eq(users.id, account.id));
    expect(updated.passwordHash).toBe(passwordHash);
    expect(updated.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("does not restore a disabled administrator's old cookie on reactivation", async () => {
    const db = await createTestDb();
    const [account] = await db.insert(users).values({ name: "Admin", email: "reactivate@x.vn", passwordHash: "x", isAdmin: true, isActive: false }).returning();
    const secret = "s".repeat(40);
    const oldCookie = await encryptSession({ userId: account.id, sat: Math.floor(Date.now() / 1000) - 60 }, secret);
    expect((await bootstrapAdmin(db, { name: account.name, email: account.email })).ok).toBe(true);
    expect(await loadSessionUser(db, oldCookie, secret)).toBeNull();
  });

  it("refuses to promote an existing non-admin account unless promoteExisting is explicitly set (L2)", async () => {
    const db = await createTestDb();
    const passwordHash = await hashPassword("existing-glv-pass-1");
    const [account] = await db.insert(users).values({ name: "GLV", email: "glv@x.vn", passwordHash }).returning();
    for (const input of [
      { email: account.email, name: "Admin" },
      { email: account.email, name: "Admin", password: "replacement-pass-2" },
      { email: account.email, name: "Admin", promoteExisting: "yes" },
    ]) {
      const result = await bootstrapAdmin(db, input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/--promote-existing/);
    }
    const [after] = await db.select().from(users).where(eq(users.id, account.id));
    expect(after).toMatchObject({ isAdmin: false, passwordHash, sessionVersion: 0 });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("re-running against an existing admin needs no promote flag", async () => {
    const db = await createTestDb();
    const [account] = await db.insert(users).values({ name: "Admin", email: "admin@x.vn", passwordHash: "x", isAdmin: true }).returning();
    const result = await bootstrapAdmin(db, { email: "admin@x.vn", name: "Admin" });
    expect(result).toMatchObject({ ok: true, data: { id: account.id, created: false } });
  });

  it("matches an existing email case-insensitively instead of creating a duplicate identity (L3)", async () => {
    const db = await createTestDb();
    const passwordHash = await hashPassword("legacy-pass-1234");
    const [legacy] = await db.insert(users).values({ name: "Legacy", email: "Foo@X.vn", passwordHash }).returning();
    const refused = await bootstrapAdmin(db, { email: "foo@x.vn", name: "Admin", password: "bootstrap-test-pass-1" });
    expect(refused.ok).toBe(false);
    expect(await db.select().from(users)).toHaveLength(1);
    const promoted = await bootstrapAdmin(db, { email: "FOO@x.vn", name: "Admin", promoteExisting: true });
    expect(promoted).toMatchObject({ ok: true, data: { id: legacy.id, created: false, email: "foo@x.vn" } });
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(1);
    // The promoted row is normalized to the lower-case address that login actually uses.
    expect(rows[0]).toMatchObject({ id: legacy.id, email: "foo@x.vn", isAdmin: true, passwordHash });
  });

  it("refuses when several stored accounts differ only by email case", async () => {
    const db = await createTestDb();
    await db.insert(users).values([
      { name: "A", email: "dup@x.vn", passwordHash: "x" },
      { name: "B", email: "DUP@x.vn", passwordHash: "x" },
    ]);
    const result = await bootstrapAdmin(db, { email: "dup@x.vn", name: "Admin", promoteExisting: true });
    expect(result.ok).toBe(false);
    expect((await db.select().from(users)).every((u) => !u.isAdmin)).toBe(true);
  });
});
