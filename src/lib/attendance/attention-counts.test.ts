import { describe, expect, it } from "vitest";
import { attentionByClass } from "./attention-counts";

describe("attentionByClass", () => {
  it("counts per class and flags classes with a warning-level student", () => {
    const map = attentionByClass([
      { classId: "a", level: "watch" },
      { classId: "a", level: "warning" },
      { classId: "b", level: "watch" },
    ]);
    expect(map.get("a")).toEqual({ count: 2, hasWarning: true });
    expect(map.get("b")).toEqual({ count: 1, hasWarning: false });
    expect(map.get("c")).toBeUndefined();
  });
});
