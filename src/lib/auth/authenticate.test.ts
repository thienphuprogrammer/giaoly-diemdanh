import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loginAttempts, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { authenticate } from "./authenticate";
import { hashPassword } from "./password";

const GOOD_PW = "correct-horse-1";

async function setup() {
  const db = await createTestDb();
  const [user] = await db
    .insert(users)
    .values({ email: "glv@x.vn", name: "GLV", passwordHash: await hashPassword(GOOD_PW) })
    .returning();
  return { db, user };
}
const now = new Date("2026-10-11T10:00:00Z");

describe("authenticate", () => {
  it("accepts correct credentials, ignoring email case and spaces", async () => {
    const { db, user } = await setup();
    const r = await authenticate(db, { email: "  GLV@x.vn ", password: GOOD_PW }, now);
    expect(r).toEqual({ ok: true, userId: user.id, sessionVersion: user.sessionVersion });
  });

  it("rejects a wrong password and records the attempt", async () => {
    const { db } = await setup();
    expect(await authenticate(db, { email: "glv@x.vn", password: "nope" }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(loginAttempts)).toHaveLength(1);
  });

  it("rejects an unknown email the same way", async () => {
    const { db } = await setup();
    expect(await authenticate(db, { email: "ghost@x.vn", password: "x" }, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an inactive account even with the right password and retains its failed attempt", async () => {
    const { db, user } = await setup();
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect(await authenticate(db, { email: user.email, password: GOOD_PW }, now)).toEqual({ ok: false, reason: "invalid" });
    expect(await db.select().from(loginAttempts)).toHaveLength(1);
  });

  it("applies the same attempt limit to an inactive account", async () => {
    const { db, user } = await setup();
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    for (let i = 0; i < 5; i++) {
      expect(await authenticate(db, { email: user.email, password: GOOD_PW }, now)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await authenticate(db, { email: user.email, password: GOOD_PW }, now)).toEqual({ ok: false, reason: "locked" });
  });

  it("accepts active admins and clears their failed attempts", async () => {
    const { db, user } = await setup();
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
    await authenticate(db, { email: user.email, password: "wrong" }, now);
    expect(await authenticate(db, { email: user.email, password: GOOD_PW }, now)).toEqual({ ok: true, userId: user.id, sessionVersion: user.sessionVersion });
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("locks after 5 failures even with the right password", async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    expect(await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, now)).toEqual({ ok: false, reason: "locked" });
  });

  it("unlocks once the window has passed", async () => {
    const { db } = await setup();
    for (let i = 0; i < 5; i++) await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    const later = new Date(now.getTime() + 16 * 60_000);
    expect((await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, later)).ok).toBe(true);
  });

  it("clears failed attempts after a successful login", async () => {
    const { db } = await setup();
    await authenticate(db, { email: "glv@x.vn", password: "bad" }, now);
    await authenticate(db, { email: "glv@x.vn", password: GOOD_PW }, now);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("caps concurrent wrong-password attempts at the limit", async () => {
    const { db } = await setup();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => authenticate(db, { email: "glv@x.vn", password: "bad" }, now)),
    );
    expect(results.filter((r) => !r.ok && r.reason === "invalid").length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => !r.ok && r.reason === "locked").length).toBeGreaterThanOrEqual(7);
  });
});
