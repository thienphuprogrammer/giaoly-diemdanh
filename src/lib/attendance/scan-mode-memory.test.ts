import { describe, expect, it } from "vitest";
import { parseScanMode, scanModeKey } from "./scan-mode-memory";

describe("scan mode memory", () => {
  it("is keyed per session so a new week starts in Có mặt", () => {
    expect(scanModeKey("ss1")).not.toBe(scanModeKey("ss2"));
  });

  it("accepts only known modes and defaults to present", () => {
    expect(parseScanMode("late")).toBe("late");
    expect(parseScanMode("present")).toBe("present");
    expect(parseScanMode(null)).toBe("present");
    expect(parseScanMode("absent")).toBe("present");
  });
});
