import { describe, expect, it } from "vitest";
import { MASS_CHOICES, massMarksFor, massSummary, toMassStatus } from "./mass-marks";

const P = { status: "present" as const, reason: null };
const X = { status: "absent_unexcused" as const, reason: null };
const E = { status: "absent_excused" as const, reason: "Ốm" };

describe("toMassStatus", () => {
  it("never yields 'late': an old late row reads as 'went to Mass'", () => {
    expect(toMassStatus("late")).toBe("present");
    expect(toMassStatus("present")).toBe("present");
    expect(toMassStatus("absent_excused")).toBe("absent_excused");
    expect(toMassStatus("absent_unexcused")).toBe("absent_unexcused");
  });
});

describe("massMarksFor", () => {
  it("gives every roster student a mark (null = chưa hỏi) and ignores rows of students not on the roster", () => {
    expect(massMarksFor(["a", "b", "c"], { a: P, c: E, zz: X })).toEqual({ a: P, b: null, c: E });
  });
});

describe("massSummary", () => {
  it("counts who went, who is not asked yet, out of the roster", () => {
    expect(massSummary(["a", "b", "c", "d"], { a: P, b: X, c: null })).toEqual({ went: 1, unasked: 2, total: 4 });
    expect(massSummary([], {})).toEqual({ went: 0, unasked: 0, total: 0 });
  });
});

describe("MASS_CHOICES", () => {
  it("offers exactly the four states, without 'late', each with a full accessible label", () => {
    expect(MASS_CHOICES.map((c) => c.value)).toEqual([null, "present", "absent_excused", "absent_unexcused"]);
    expect(MASS_CHOICES.map((c) => c.label)).toEqual(["Chưa hỏi", "Có đi lễ", "Không đi lễ có phép", "Không đi lễ không phép"]);
    for (const c of MASS_CHOICES) expect(c.short.length).toBeLessThanOrEqual(10);
  });
});
