import { describe, expect, it } from "vitest";
import { countMarked, createSequencer, initialMarks } from "./marks";

describe("initialMarks", () => {
  it("maps students to marks or null", () => {
    const m = initialMarks([
      { id: "a", status: "late", reason: "xe hư" },
      { id: "b", status: null, reason: null },
    ]);
    expect(m).toEqual({ a: { status: "late", reason: "xe hư" }, b: null });
  });
});

describe("countMarked", () => {
  it("counts non-null marks", () => {
    expect(countMarked({ a: { status: "present", reason: null }, b: null })).toBe(1);
  });
});

describe("createSequencer", () => {
  it("treats only the newest begin per key as latest", () => {
    const s = createSequencer();
    const first = s.begin("a");
    const second = s.begin("a");
    const other = s.begin("b");
    expect(s.isLatest("a", first)).toBe(false);
    expect(s.isLatest("a", second)).toBe(true);
    expect(s.isLatest("b", other)).toBe(true);
  });
});
