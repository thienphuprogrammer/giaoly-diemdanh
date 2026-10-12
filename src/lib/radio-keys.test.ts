import { describe, expect, it } from "vitest";
import { nextRadioIndex } from "./radio-keys";

describe("nextRadioIndex (roving tabindex radiogroup)", () => {
  it("moves forward with ArrowRight/ArrowDown and wraps", () => {
    expect(nextRadioIndex(0, 2, "ArrowRight")).toBe(1);
    expect(nextRadioIndex(1, 2, "ArrowDown")).toBe(0);
  });
  it("moves backward with ArrowLeft/ArrowUp and wraps", () => {
    expect(nextRadioIndex(0, 2, "ArrowLeft")).toBe(1);
    expect(nextRadioIndex(2, 3, "ArrowUp")).toBe(1);
  });
  it("jumps with Home/End", () => {
    expect(nextRadioIndex(1, 3, "Home")).toBe(0);
    expect(nextRadioIndex(0, 3, "End")).toBe(2);
  });
  it("ignores other keys and empty groups", () => {
    expect(nextRadioIndex(0, 2, "Enter")).toBeNull();
    expect(nextRadioIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
