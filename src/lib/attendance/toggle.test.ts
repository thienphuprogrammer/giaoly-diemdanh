import { describe, expect, it } from "vitest";
import { toggleStatus } from "./toggle";

describe("toggleStatus", () => {
  it("goes unmarked → present → absent_unexcused → present", () => {
    expect(toggleStatus(null)).toBe("present");
    expect(toggleStatus("present")).toBe("absent_unexcused");
    expect(toggleStatus("absent_unexcused")).toBe("present");
  });
  it("resets late and excused to present", () => {
    expect(toggleStatus("late")).toBe("present");
    expect(toggleStatus("absent_excused")).toBe("present");
  });
});
