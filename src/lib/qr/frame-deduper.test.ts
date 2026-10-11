import { describe, expect, it } from "vitest";
import { createFrameDeduper } from "./frame-deduper";

describe("createFrameDeduper", () => {
  it("accepts the first sighting and ignores the same code while it stays in view", () => {
    const d = createFrameDeduper(600);
    expect(d.accept("A", 0)).toBe(true);
    expect([100, 200, 400, 800, 1200].map((t) => d.accept("A", t))).toEqual([false, false, false, false, false]);
  });
  it("accepts a different code immediately, even right after another", () => {
    const d = createFrameDeduper(600);
    d.accept("A", 0);
    expect(d.accept("B", 50)).toBe(true);
    expect(d.accept("A", 100)).toBe(true);
  });
  it("accepts the same code again after it left the frame for longer than the gap", () => {
    const d = createFrameDeduper(600);
    d.accept("A", 0);
    expect(d.accept("A", 100)).toBe(false);
    expect(d.accept("A", 100 + 601)).toBe(true);
  });
});
