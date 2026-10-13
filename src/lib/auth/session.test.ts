import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession, readSession } from "./session";
import { SESSION_ABSOLUTE_MAX_S, SESSION_MAX_AGE_S } from "./session-policy";

const SECRET = "s".repeat(32);

describe("session", () => {
  it("round-trips the payload", async () => {
    const token = await encryptSession({ userId: "u1" }, SECRET);
    expect(await decryptSession(token, SECRET)).toEqual({ userId: "u1" });
  });

  it("rejects a tampered token", async () => {
    const token = await encryptSession({ userId: "u1" }, SECRET);
    expect(await decryptSession(token.slice(0, -3) + "abc", SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await encryptSession({ userId: "u1" }, "t".repeat(32));
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = await encryptSession({ userId: "u1" }, SECRET, past);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("returns null for missing or empty token", async () => {
    expect(await decryptSession(undefined, SECRET)).toBeNull();
    expect(await decryptSession("", SECRET)).toBeNull();
  });

  it("by default expires after the 30-day session lifetime", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await encryptSession({ userId: "u1" }, SECRET);
    const read = await readSession(token, SECRET);
    expect(read?.userId).toBe("u1");
    expect(read!.exp - before).toBeGreaterThanOrEqual(SESSION_MAX_AGE_S);
    expect(read!.exp - before).toBeLessThanOrEqual(SESSION_MAX_AGE_S + 2);
  });

  it("readSession exposes exp only for a valid token", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = await encryptSession({ userId: "u1" }, SECRET, exp);
    expect(await readSession(token, SECRET)).toMatchObject({ userId: "u1", exp });
    expect(await readSession(token, "t".repeat(32))).toBeNull();
    expect(await readSession(undefined, SECRET)).toBeNull();
    const expired = await encryptSession({ userId: "u1" }, SECRET, Math.floor(Date.now() / 1000) - 1);
    expect(await readSession(expired, SECRET)).toBeNull();
  });

  const now = () => Math.floor(Date.now() / 1000);
  const DAY = 24 * 60 * 60;

  it("sets sat (session-auth time) to now at login and returns it", async () => {
    const before = now();
    const read = await readSession(await encryptSession({ userId: "u1" }, SECRET), SECRET);
    expect(read!.sat).toBeGreaterThanOrEqual(before);
    expect(read!.sat).toBeLessThanOrEqual(now());
  });

  it("keeps a given sat unchanged (refresh)", async () => {
    const sat = now() - 40 * DAY;
    const read = await readSession(await encryptSession({ userId: "u1", sat }, SECRET), SECRET);
    expect(read?.sat).toBe(sat);
  });

  it("migrates a token without sat to sat = exp - 30 days", async () => {
    const exp = now() + 7 * DAY;
    const legacy = await new SignJWT({ userId: "u1" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(exp).sign(new TextEncoder().encode(SECRET));
    expect(await readSession(legacy, SECRET)).toEqual({ userId: "u1", exp, sat: exp - SESSION_MAX_AGE_S, ver: 0 });
  });

  it("refuses a token whose login is older than 90 days, in readSession and decryptSession (DAL)", async () => {
    const token = await encryptSession({ userId: "u1", sat: now() - SESSION_ABSOLUTE_MAX_S - 3600 }, SECRET, now() + DAY);
    expect(await readSession(token, SECRET)).toBeNull();
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("accepts a token logged in 89 days ago", async () => {
    const token = await encryptSession({ userId: "u1", sat: now() - 89 * DAY }, SECRET, now() + DAY);
    expect(await decryptSession(token, SECRET)).toEqual({ userId: "u1" });
  });

  it("refuses a validly signed token whose exp exceeds the 30-day maximum (same check as the proxy)", async () => {
    const token = await encryptSession({ userId: "u1" }, SECRET, now() + 60 * DAY);
    expect(await readSession(token, SECRET)).toBeNull();
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("refuses a non-numeric sat", async () => {
    const token = await new SignJWT({ userId: "u1", sat: "x" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(now() + DAY).sign(new TextEncoder().encode(SECRET));
    expect(await readSession(token, SECRET)).toBeNull();
  });
});

describe("revocation epoch claims", () => {
  it("preserves the revocation version on refresh and defaults old cookies to zero", async () => {
    const original = await readSession(await encryptSession({ userId: "u1", ver: 7 }, SECRET), SECRET);
    expect(original?.ver).toBe(7);
    const refreshed = await readSession(await encryptSession({ userId: "u1", sat: original!.sat, ver: original!.ver }, SECRET), SECRET);
    expect(refreshed?.ver).toBe(7);
    expect((await readSession(await encryptSession({ userId: "u1" }, SECRET), SECRET))?.ver).toBe(0);
  });
  it.each([-1, 1.5, "1", null])("rejects malformed signed versions: %s", async (ver) => {
    const token = await new SignJWT({ userId: "u1", ver }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(Math.floor(Date.now() / 1000) + 1000).sign(new TextEncoder().encode(SECRET));
    expect(await readSession(token, SECRET)).toBeNull();
  });
});
