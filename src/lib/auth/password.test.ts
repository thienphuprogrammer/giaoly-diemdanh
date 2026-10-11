import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

const GOOD_PW = "correct-horse-battery";
const OTHER_PW = "secret-secret";

describe("password", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword(GOOD_PW);
    expect(await verifyPassword(GOOD_PW, hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("does not store the plain password", async () => {
    expect(await hashPassword(OTHER_PW)).not.toContain(OTHER_PW);
  });

  it("exposes a valid dummy hash for constant-time failures", async () => {
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});
