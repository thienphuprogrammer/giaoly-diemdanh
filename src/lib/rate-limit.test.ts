import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per window, then blocks with a retry hint", () => {
    const l = createRateLimiter({ max: 3, windowMs: 1000 });
    expect([1, 2, 3].map((i) => l.hit("u", i * 10).allowed)).toEqual([true, true, true]);
    expect(l.hit("u", 40)).toEqual({ allowed: false, retryAfterMs: 970 });
  });
  it("lets traffic through again once old hits leave the window", () => {
    const l = createRateLimiter({ max: 2, windowMs: 1000 });
    l.hit("u", 0); l.hit("u", 100);
    expect(l.hit("u", 500).allowed).toBe(false);
    expect(l.hit("u", 1001).allowed).toBe(true);
  });
  it("tracks keys independently", () => {
    const l = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(l.hit("a", 0).allowed).toBe(true);
    expect(l.hit("b", 0).allowed).toBe(true);
    expect(l.hit("a", 1).allowed).toBe(false);
  });
});
