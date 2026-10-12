import { describe, expect, it } from "vitest";
import { MASS_THRESHOLD_MAX, MASS_THRESHOLD_MIN, isMassWarning, tallyMass } from "./mass-tally";

const weeks = [
  { sessionId: "w1", heldOn: "2026-10-04" },
  { sessionId: "w2", heldOn: "2026-10-11" },
  { sessionId: "w3", heldOn: "2026-10-18" },
];

describe("tallyMass (spec §1b + mid-term joiner heuristic)", () => {
  it("counts every recorded week once the student was first seen before them", () => {
    expect(tallyMass(weeks, "2026-09-12", new Set(["w2"]))).toEqual({
      counted: 3, attended: 1, missed: 2, cells: ["missed", "attended", "missed"],
    });
  });

  it("does not count weeks before the student's first attendance row (joined mid-term)", () => {
    expect(tallyMass(weeks, "2026-10-10", new Set(["w3"]))).toEqual({
      counted: 2, attended: 1, missed: 1, cells: ["not_counted", "missed", "attended"],
    });
  });

  it("counts the week of the first row itself (first seen on that Sunday)", () => {
    expect(tallyMass(weeks, "2026-10-11", new Set()).cells).toEqual(["not_counted", "missed", "missed"]);
  });

  it("a student never recorded anywhere counts no week at all", () => {
    expect(tallyMass(weeks, null, new Set())).toEqual({
      counted: 0, attended: 0, missed: 0, cells: ["not_counted", "not_counted", "not_counted"],
    });
  });

  it("no recorded weeks => nothing to count", () => {
    expect(tallyMass([], "2026-09-12", new Set())).toEqual({ counted: 0, attended: 0, missed: 0, cells: [] });
  });
});

describe("isMassWarning", () => {
  it("warns at exactly the threshold, not one below", () => {
    expect(isMassWarning(2, 2)).toBe(true);
    expect(isMassWarning(1, 2)).toBe(false);
    expect(isMassWarning(3, 2)).toBe(true);
    expect(isMassWarning(1, 1)).toBe(true);
    expect(isMassWarning(0, 1)).toBe(false);
  });

  it("exposes the editable threshold range", () => {
    expect([MASS_THRESHOLD_MIN, MASS_THRESHOLD_MAX]).toEqual([1, 20]);
  });
});
