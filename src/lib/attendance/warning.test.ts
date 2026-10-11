import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  countUnexcused,
  evaluateWarning,
  evaluateWarningFromCount,
  type AttendanceStatus,
} from "./warning";

const r = (...s: AttendanceStatus[]) => s.map((status) => ({ status }));

describe("countUnexcused", () => {
  it("counts only absent_unexcused", () => {
    expect(
      countUnexcused(r("present", "absent_excused", "absent_unexcused", "late")),
    ).toBe(1);
  });

  it("returns 0 for empty history", () => {
    expect(countUnexcused([])).toBe(0);
  });
});

describe("evaluateWarning", () => {
  it("is none with no unexcused absences", () => {
    expect(evaluateWarning(r("present", "absent_excused", "late")).level).toBe("none");
  });

  it("is watch at 1 unexcused absence", () => {
    const w = evaluateWarning(r("present", "absent_unexcused"));
    expect(w.level).toBe("watch");
    expect(w.remaining).toBe(1);
  });

  it("is warning at the threshold (2)", () => {
    const w = evaluateWarning(r("absent_unexcused", "absent_unexcused"));
    expect(w.level).toBe("warning");
    expect(w.remaining).toBe(0);
  });

  it("stays warning beyond the threshold", () => {
    const w = evaluateWarning(
      r("absent_unexcused", "absent_unexcused", "absent_unexcused"),
    );
    expect(w.level).toBe("warning");
    expect(w.unexcused).toBe(3);
  });

  it("does not count late or excused toward the threshold", () => {
    expect(
      evaluateWarning(r("late", "late", "late", "absent_excused", "absent_excused")).level,
    ).toBe("none");
  });

  it("respects a custom threshold", () => {
    const rules = { ...DEFAULT_RULES, unexcusedThreshold: 3 };
    expect(evaluateWarning(r("absent_unexcused", "absent_unexcused"), rules).level).toBe("watch");
    expect(evaluateWarning(r("absent_unexcused", "absent_unexcused", "absent_unexcused"), rules).level).toBe("warning");
  });
});

describe("evaluateWarningFromCount", () => {
  it("maps counts to levels with the default threshold", () => {
    expect(evaluateWarningFromCount(0)).toEqual({ level: "none", unexcused: 0, remaining: 2 });
    expect(evaluateWarningFromCount(1)).toEqual({ level: "watch", unexcused: 1, remaining: 1 });
    expect(evaluateWarningFromCount(2)).toEqual({ level: "warning", unexcused: 2, remaining: 0 });
    expect(evaluateWarningFromCount(5).level).toBe("warning");
  });
});
