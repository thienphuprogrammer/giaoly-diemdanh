import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { encryptSession } from "@/lib/auth/session";
import { loadSessionUser } from "@/lib/auth/session-user";
import { authenticate } from "@/lib/auth/authenticate";
import { hashPassword } from "@/lib/auth/password";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setAccountActive, updateAccount } from "./system-admin";
import { createSchoolYear } from "./school-years";
import { bootstrapAdmin } from "./system-admin-bootstrap";

const KEY = "v".repeat(40);
const ADMIN_PW = "session-admin-pass-1";
const second = () => Math.floor(Date.now() / 1000);
async function setup() {
  const db = await createTestDb();
  const basics = await seedBasics(db);
  const [admin] = await db.insert(users).values({ name: "Admin", email: "admin@x.vn", passwordHash: await hashPassword(ADMIN_PW), isAdmin: true }).returning();
  return { db, basics, admin };
}

describe("exact session revocation", () => {
  it("never revives a cookie after disable and re-enable in the very same second", async () => {
    const { db, basics, admin } = await setup();
    const sat = second();
    const old = await encryptSession({ userId: basics.glv.id, sat, ver: 0 }, KEY);
    expect(await loadSessionUser(db, old, KEY)).not.toBeNull();
    const at = new Date(sat * 1000);
    expect((await setAccountActive(db, admin, { userId: basics.glv.id, isActive: false }, at)).ok).toBe(true);
    expect((await setAccountActive(db, admin, { userId: basics.glv.id, isActive: true }, at)).ok).toBe(true);
    expect(await loadSessionUser(db, old, KEY)).toBeNull();
    const fresh = await encryptSession({ userId: basics.glv.id, sat, ver: 2 }, KEY);
    expect(await loadSessionUser(db, fresh, KEY)).toMatchObject({ id: basics.glv.id, sessionVersion: 2 });
  });

  it("requires a fresh session when an active catechist is promoted to admin", async () => {
    const { db, basics, admin } = await setup();
    const sat = second();
    const old = await encryptSession({ userId: basics.glv.id, sat, ver: 0 }, KEY);
    expect((await updateAccount(db, admin, { userId: basics.glv.id, name: basics.glv.name, email: basics.glv.email, role: "admin", currentPassword: ADMIN_PW })).ok).toBe(true);
    expect(await loadSessionUser(db, old, KEY)).toBeNull();
    const [row] = await db.select().from(users).where(eq(users.id, basics.glv.id));
    expect(row.sessionVersion).toBe(1);
    expect(await loadSessionUser(db, await encryptSession({ userId: row.id, sat: second(), ver: row.sessionVersion }, KEY), KEY)).toMatchObject({ isAdmin: true });
  });

  it("bootstrapping an existing active account invalidates its old epoch without changing its hash", async () => {
    const { db, basics } = await setup();
    const sat = second();
    const old = await encryptSession({ userId: basics.glv.id, sat, ver: 0 }, KEY);
    expect((await bootstrapAdmin(db, { email: basics.glv.email, name: "Admin", promoteExisting: true }, new Date(sat * 1000))).ok).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, basics.glv.id));
    expect(row.passwordHash).toBe(basics.glv.passwordHash);
    expect(row.sessionVersion).toBe(1);
    expect(await loadSessionUser(db, old, KEY)).toBeNull();
  });

  it("uses the credential snapshot epoch so a reset between verification and cookie issuance cannot create a fresh session", async () => {
    const { db, basics } = await setup();
    await db.update(users).set({ passwordHash: await hashPassword("snapshot-password-1") }).where(eq(users.id, basics.glv.id));
    const authenticated = await authenticate(db, { email: basics.glv.email, password: "snapshot-password-1" });
    if (!authenticated.ok) throw new Error("fixture login failed");
    await db.update(users).set({ sessionVersion: 1 }).where(eq(users.id, basics.glv.id));
    const stale = await encryptSession({ userId: authenticated.userId, ver: authenticated.sessionVersion }, KEY);
    expect(await loadSessionUser(db, stale, KEY)).toBeNull();
  });

  it("rejects a queued administrative operation from an already revoked request", async () => {
    const { db, admin } = await setup();
    await db.update(users).set({ sessionVersion: 1 }).where(eq(users.id, admin.id));
    const year = { name: "Năm kế tiếp", term1: { name: "1", startsOn: "2027-09-01", endsOn: "2028-01-15" }, term2: { name: "2", startsOn: "2028-02-01", endsOn: "2028-06-01" } };
    expect((await createSchoolYear(db, admin, year, "2026-10-13")).ok).toBe(false);
    expect((await createSchoolYear(db, { ...admin, sessionVersion: 1 }, year, "2026-10-13")).ok).toBe(true);
  });
});
