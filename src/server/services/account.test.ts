import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, loginAttempts, users } from "@/db/schema";
import type { AppUser } from "@/lib/access/can-access";
import { authenticate } from "@/lib/auth/authenticate";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { encryptSession } from "@/lib/auth/session";
import { passwordChangeSecond } from "@/lib/auth/session-policy";
import { loadSessionUser } from "@/lib/auth/session-user";
import { createRateLimiter } from "@/lib/rate-limit";
import { breakAuditInserts } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { changePassword } from "./account";

const OLD_PW = "mat-khau-cu-123";
const NEW_PW = "mat-khau-moi-456";
const WRONG_PW = "khong-dung-789";
const SIGNING_KEY = "k".repeat(40);
const now = new Date("2026-10-12T10:00:00.750Z");

async function setup() {
  const db = await createTestDb();
  const [row] = await db.insert(users).values({ email: "glv@x.vn", name: "GLV", passwordHash: await hashPassword(OLD_PW) }).returning();
  const user: AppUser = { id: row.id, email: row.email, name: row.name, isAdmin: false, sessionVersion: row.sessionVersion, isGradeHead: false, gradeId: null };
  const hashOf = async () => (await db.select().from(users).where(eq(users.id, row.id)))[0].passwordHash;
  return { db, user, hashOf };
}
const input = (over: Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", unknown>> = {}) => ({
  currentPassword: OLD_PW, newPassword: NEW_PW, confirmPassword: NEW_PW, ...over,
});

describe("changePassword: validation", () => {
  it.each([
    ["too short", { newPassword: "ngan-9chr", confirmPassword: "ngan-9chr" }, "Mật khẩu mới phải có ít nhất 10 ký tự", "newPassword"],
    ["more than 72 bytes (ASCII)", { newPassword: "a".repeat(73), confirmPassword: "a".repeat(73) }, /tối đa 72 byte/, "newPassword"],
    // 25 ký tự "ệ" = 75 byte UTF-8: dưới 72 ký tự nhưng bcrypt sẽ cắt, nên phải từ chối theo byte.
    ["more than 72 bytes (UTF-8)", { newPassword: "ệ".repeat(25), confirmPassword: "ệ".repeat(25) }, /tối đa 72 byte/, "newPassword"],
    ["mismatched confirmation", { confirmPassword: `${NEW_PW}x` }, "Mật khẩu xác nhận không khớp", "confirmPassword"],
    ["same as current", { newPassword: OLD_PW, confirmPassword: OLD_PW }, "Mật khẩu mới phải khác mật khẩu hiện tại", "newPassword"],
    ["missing current", { currentPassword: "" }, "Nhập mật khẩu hiện tại", "currentPassword"],
    ["non-string input", { newPassword: 123 }, "Mật khẩu mới phải có ít nhất 10 ký tự", "newPassword"],
  ])("rejects %s without touching the hash or recording an attempt", async (_label, over, message, field) => {
    const { db, user, hashOf } = await setup();
    const before = await hashOf();
    const r = await changePassword(db, user, input(over), { now });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(message);
    expect(r.field).toBe(field);
    expect(await hashOf()).toBe(before);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("accepts exactly 72 ASCII bytes and exactly 10 characters", async () => {
    const { db, user } = await setup();
    const exact = "b".repeat(72);
    expect((await changePassword(db, user, input({ newPassword: exact, confirmPassword: exact }), { now })).ok).toBe(true);
    const ten = "c".repeat(10);
    expect((await changePassword(db, { ...user, sessionVersion: 1 }, input({ currentPassword: exact, newPassword: ten, confirmPassword: ten }), { now })).ok).toBe(true);
  });
});

describe("changePassword: current password and lockout", () => {
  it("rejects a wrong current password with a generic message and records the attempt", async () => {
    const { db, user, hashOf } = await setup();
    const before = await hashOf();
    expect(await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now }))
      .toEqual({ ok: false, error: "Mật khẩu hiện tại không đúng", field: "currentPassword" });
    expect(await hashOf()).toBe(before);
    // M2: change-password has its own counter keyed by user id, never the email-keyed login counter.
    expect(await db.select().from(loginAttempts).where(eq(loginAttempts.email, `acct:${user.id}`))).toHaveLength(1);
    expect(await db.select().from(loginAttempts).where(eq(loginAttempts.email, "glv@x.vn"))).toHaveLength(0);
  });

  it("locks after 5 wrong current passwords, even with the right one, with the lockout message", async () => {
    const { db, user, hashOf } = await setup();
    const before = await hashOf();
    for (let i = 0; i < 5; i++) await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now });
    expect(await changePassword(db, user, input(), { now }))
      .toEqual({ ok: false, error: "Nhập sai mật khẩu quá nhiều lần. Thử lại sau 15 phút.", field: null });
    expect(await hashOf()).toBe(before);
    // Bộ đếm riêng theo user id: sai mật khẩu khi đổi không khóa đăng nhập theo email.
    expect((await authenticate(db, { email: "glv@x.vn", password: OLD_PW }, now)).ok).toBe(true);
  });

  it("is not blocked by failed logins against the user's email (third parties cannot lock the change path)", async () => {
    const { db, user } = await setup();
    for (let i = 0; i < 6; i++) await authenticate(db, { email: "glv@x.vn", password: WRONG_PW }, now);
    expect(await authenticate(db, { email: "glv@x.vn", password: OLD_PW }, now)).toEqual({ ok: false, reason: "locked" });
    expect((await changePassword(db, user, input(), { now })).ok).toBe(true);
  });

  it("unlocks after the 15-minute window", async () => {
    const { db, user } = await setup();
    for (let i = 0; i < 5; i++) await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now });
    const later = new Date(now.getTime() + 16 * 60_000);
    expect((await changePassword(db, user, input(), { now: later })).ok).toBe(true);
  });

  it("refuses with a rate-limit message once the per-user limiter is exhausted", async () => {
    const { db, user, hashOf } = await setup();
    const before = await hashOf();
    const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
    await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now, limiter });
    const r = await changePassword(db, user, input(), { now, limiter });
    expect(r).toEqual({ ok: false, error: "Thao tác quá nhanh, vui lòng thử lại sau ít phút", field: null });
    expect(await hashOf()).toBe(before);
  });
});

describe("changePassword: success", () => {
  it("updates the hash and password_changed_at (truncated to the second), clears attempts and returns the change time", async () => {
    const { db, user, hashOf } = await setup();
    await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now });
    const r = await changePassword(db, user, input(), { now });
    expect(r).toEqual({ ok: true, changedAt: passwordChangeSecond(now), sessionVersion: 1 });
    expect(await verifyPassword(NEW_PW, await hashOf())).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row.passwordChangedAt).toEqual(new Date("2026-10-12T10:00:00.000Z"));
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("clears only its own counter, leaving the email-keyed login attempts untouched", async () => {
    const { db, user } = await setup();
    await db.insert(loginAttempts).values({ email: "glv@x.vn", attemptedAt: now });
    await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now });
    expect((await changePassword(db, user, input(), { now })).ok).toBe(true);
    expect((await db.select().from(loginAttempts)).map((a) => a.email)).toEqual(["glv@x.vn"]);
  });

  it("audits a successful self-service change in the same transaction, without any secret", async () => {
    const { db, user, hashOf } = await setup();
    await changePassword(db, user, input({ currentPassword: WRONG_PW }), { now });
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect((await changePassword(db, user, input(), { now })).ok).toBe(true);
    const events = await db.select().from(auditEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: user.id, entity: "account", entityId: user.id, action: "account.change_password", classId: null, gradeId: null });
    const dump = JSON.stringify(events);
    for (const secret of [OLD_PW, NEW_PW, await hashOf()]) expect(dump).not.toContain(secret);
  });

  it("rolls the change back (generic error, old password still valid) when the audit cannot be recorded", async () => {
    const { db, user, hashOf } = await setup();
    const before = await hashOf();
    await breakAuditInserts(db);
    expect(await changePassword(db, user, input(), { now }))
      .toEqual({ ok: false, error: "Không đổi được mật khẩu. Vui lòng thử lại", field: null });
    expect(await hashOf()).toBe(before);
  });

  it("old password no longer logs in, the new one does", async () => {
    const { db, user } = await setup();
    expect((await changePassword(db, user, input(), { now })).ok).toBe(true);
    expect(await authenticate(db, { email: "glv@x.vn", password: OLD_PW }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(db, { email: "glv@x.vn", password: NEW_PW }, now)).toEqual({ ok: true, userId: user.id, sessionVersion: 1 });
  });

  it("revokes sessions created before the change; a session created after (or in the same second) is accepted", async () => {
    const { db, user } = await setup();
    const changeS = Math.floor(Date.now() / 1000);
    const before = await encryptSession({ userId: user.id, sat: changeS - 1 }, SIGNING_KEY);
    expect(await loadSessionUser(db, before, SIGNING_KEY)).not.toBeNull();
    expect((await changePassword(db, user, input(), { now: new Date(changeS * 1000 + 400) })).ok).toBe(true);
    expect(await loadSessionUser(db, before, SIGNING_KEY)).toBeNull();
    const oldSameSecond = await encryptSession({ userId: user.id, sat: changeS, ver: 0 }, SIGNING_KEY);
    expect(await loadSessionUser(db, oldSameSecond, SIGNING_KEY)).toBeNull();
    const sameSecond = await encryptSession({ userId: user.id, sat: changeS, ver: 1 }, SIGNING_KEY);
    expect(await loadSessionUser(db, sameSecond, SIGNING_KEY)).not.toBeNull();
  });

  it("fails generically when the user row no longer exists", async () => {
    const { db, user } = await setup();
    await db.delete(users).where(eq(users.id, user.id));
    expect(await changePassword(db, user, input(), { now }))
      .toEqual({ ok: false, error: "Mật khẩu hiện tại không đúng", field: "currentPassword" });
  });
});
