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
    expect(r).toEqual({ ok: true, userId: user.id });
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
});
