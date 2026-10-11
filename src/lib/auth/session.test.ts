import { describe, expect, it } from "vitest";
import { decryptSession, encryptSession } from "./session";

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
});
