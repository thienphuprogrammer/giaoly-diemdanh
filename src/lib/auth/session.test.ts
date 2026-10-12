import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession, readSession } from "./session";
import { SESSION_MAX_AGE_S } from "./session-policy";

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
    expect(await readSession(token, SECRET)).toEqual({ userId: "u1", exp });
    expect(await readSession(token, "t".repeat(32))).toBeNull();
    expect(await readSession(undefined, SECRET)).toBeNull();
    const expired = await encryptSession({ userId: "u1" }, SECRET, Math.floor(Date.now() / 1000) - 1);
    expect(await readSession(expired, SECRET)).toBeNull();
  });
});
