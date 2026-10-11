import { describe, expect, it } from "vitest";
import { summarize } from "./summary";

describe("summarize", () => {
  it("counts each status and derives the warning", () => {
    const s = summarize([
      { status: "present" }, { status: "present" }, { status: "late" },
      { status: "absent_excused" }, { status: "absent_unexcused" }, { status: "absent_unexcused" },
    ]);
    expect(s).toMatchObject({ present: 2, late: 1, excused: 1, unexcused: 2, marked: 6 });
    expect(s.warning.level).toBe("warning");
  });
  it("is all zeros and none for no records", () => {
    expect(summarize([])).toMatchObject({ marked: 0, unexcused: 0, warning: { level: "none" } });
  });
});
