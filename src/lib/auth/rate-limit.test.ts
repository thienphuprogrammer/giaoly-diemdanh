import { describe, expect, it } from "vitest";
import { isLockedOut } from "./rate-limit";

const now = new Date("2026-10-11T10:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("isLockedOut", () => {
  it("is false below the limit", () => {
    expect(isLockedOut([minsAgo(1), minsAgo(2), minsAgo(3), minsAgo(4)], now)).toBe(false);
  });
  it("is true at the limit within the window", () => {
    expect(isLockedOut([1, 2, 3, 4, 5].map(minsAgo), now)).toBe(true);
  });
  it("ignores attempts outside the window", () => {
    expect(isLockedOut([1, 2, 3, 4, 20].map(minsAgo), now)).toBe(false);
  });
});
