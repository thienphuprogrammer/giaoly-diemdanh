import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/db/schema";
import { canAccess, canManageGrade } from "@/lib/access/can-access";
import { proxy } from "@/proxy";
import { createTestDb } from "@/test/db";
import { encryptSession, readSession } from "./session";
import { SESSION_MAX_AGE_S } from "./session-policy";
import { loadSessionUser } from "./session-user";

const SIGNING_KEY = "k".repeat(40);
const DAY = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

async function setup(passwordChangedAt: Date | null = null) {
  const db = await createTestDb();
  const [user] = await db.insert(users).values({ email: "glv@x.vn", name: "GLV", passwordHash: "x", passwordChangedAt }).returning();
  return { db, user };
}
const tokenAt = (userId: string, sat: number) => encryptSession({ userId, sat }, SIGNING_KEY);
/** Token cũ (trước khi có `sat`): chỉ userId + exp. */
const legacyToken = (userId: string, exp: number) =>
  new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(SIGNING_KEY));

beforeEach(() => { vi.stubEnv("AUTH_SECRET", SIGNING_KEY); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("loadSessionUser", () => {
  it("returns the user re-read from the DB for a valid session", async () => {
    const { db, user } = await setup();
    expect(await loadSessionUser(db, await tokenAt(user.id, nowS()), SIGNING_KEY)).toEqual({
      id: user.id, email: "glv@x.vn", name: "GLV", isAdmin: false, sessionVersion: user.sessionVersion, isGradeHead: false, gradeId: null,
    });
  });

  it("returns null without a token, for a forged token and for a deleted user", async () => {
    const { db, user } = await setup();
    expect(await loadSessionUser(db, undefined, SIGNING_KEY)).toBeNull();
    expect(await loadSessionUser(db, await encryptSession({ userId: user.id }, "z".repeat(40)), SIGNING_KEY)).toBeNull();
    const token = await tokenAt(user.id, nowS());
    await db.delete(users).where(eq(users.id, user.id));
    expect(await loadSessionUser(db, token, SIGNING_KEY)).toBeNull();
  });

  it("rejects an existing session immediately after the account is deactivated", async () => {
    const { db, user } = await setup();
    const token = await tokenAt(user.id, nowS());
    expect(await loadSessionUser(db, token, SIGNING_KEY)).not.toBeNull();
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect(await loadSessionUser(db, token, SIGNING_KEY)).toBeNull();
  });

  it("reflects an admin role change in the same cookie and omits private account fields", async () => {
    const { db, user } = await setup();
    const token = await tokenAt(user.id, nowS());
    const cls = { id: "class", gradeId: "grade", schoolYearId: "year", catechistIds: [] };
    expect((await loadSessionUser(db, token, SIGNING_KEY))?.isAdmin).toBe(false);
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
    const promoted = await loadSessionUser(db, token, SIGNING_KEY);
    expect(promoted?.isAdmin).toBe(true);
    expect(promoted).not.toHaveProperty("passwordHash");
    expect(promoted).not.toHaveProperty("passwordChangedAt");
    expect(canAccess(promoted!, cls, "write")).toBe(true);
    expect(canManageGrade(promoted!, cls.gradeId)).toBe(true);
    await db.update(users).set({ isAdmin: false }).where(eq(users.id, user.id));
    const demoted = await loadSessionUser(db, token, SIGNING_KEY);
    expect(demoted?.isAdmin).toBe(false);
    expect(canAccess(demoted!, cls, "write")).toBe(false);
    expect(canManageGrade(demoted!, cls.gradeId)).toBe(false);
  });

  it("also rejects inactive admins", async () => {
    const { db, user } = await setup();
    await db.update(users).set({ isAdmin: true, isActive: false }).where(eq(users.id, user.id));
    expect(await loadSessionUser(db, await tokenAt(user.id, nowS()), SIGNING_KEY)).toBeNull();
  });

  it("keeps legacy sessions valid when password_changed_at is null (with or without sat)", async () => {
    const { db, user } = await setup(null);
    expect(await loadSessionUser(db, await tokenAt(user.id, nowS() - 60 * DAY), SIGNING_KEY)).not.toBeNull();
    expect(await loadSessionUser(db, await legacyToken(user.id, nowS() + DAY), SIGNING_KEY)).not.toBeNull();
  });

  it("rejects a session that logged in before the password change", async () => {
    const changed = nowS() - 10;
    const { db, user } = await setup(new Date(changed * 1000));
    expect(await loadSessionUser(db, await tokenAt(user.id, changed - 1), SIGNING_KEY)).toBeNull();
    expect(await loadSessionUser(db, await tokenAt(user.id, changed - 5 * DAY), SIGNING_KEY)).toBeNull();
  });

  it("judges a legacy token without sat by its inferred login time (exp - 30 days)", async () => {
    const { db, user } = await setup(new Date((nowS() - 10) * 1000));
    expect(await loadSessionUser(db, await legacyToken(user.id, nowS() + SESSION_MAX_AGE_S - 60), SIGNING_KEY)).toBeNull();
    // exp xa hơn: lúc đăng nhập suy ra (exp - 30 ngày) sau mốc đổi → vẫn hợp lệ.
    expect(await loadSessionUser(db, await legacyToken(user.id, nowS() + SESSION_MAX_AGE_S), SIGNING_KEY)).not.toBeNull();
  });

  it("accepts a session created at or after the change (boundary: same second is accepted)", async () => {
    const changed = nowS() - 10;
    const { db, user } = await setup(new Date(changed * 1000 + 999));
    expect(await loadSessionUser(db, await tokenAt(user.id, changed), SIGNING_KEY)).not.toBeNull();
    expect(await loadSessionUser(db, await tokenAt(user.id, changed + 1), SIGNING_KEY)).not.toBeNull();
    expect(await loadSessionUser(db, await tokenAt(user.id, changed - 1), SIGNING_KEY)).toBeNull();
  });

  it("the proxy's sliding refresh keeps the old sat, so a revoked session is still rejected after refresh", async () => {
    const loggedIn = nowS() - 28 * DAY;
    const { db, user } = await setup(new Date((nowS() - DAY) * 1000));
    const old = await encryptSession({ userId: user.id, sat: loggedIn }, SIGNING_KEY, nowS() + DAY); // còn < 3 ngày → proxy cấp lại
    const res = await proxy(new NextRequest("http://app.test/", { headers: { cookie: `session=${old}` } }));
    const refreshed = res.cookies.get("session")?.value;
    expect(refreshed).toBeTruthy();
    expect(refreshed).not.toBe(old);
    expect((await readSession(refreshed, SIGNING_KEY))?.sat).toBe(loggedIn);
    expect(await loadSessionUser(db, refreshed, SIGNING_KEY)).toBeNull();
  });
});
