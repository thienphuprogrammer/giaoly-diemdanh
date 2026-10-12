import { describe, expect, it } from "vitest";
import { isFromBoard, scannerExit, scannerHrefFromBoard } from "./scan-return";

describe("scannerHrefFromBoard", () => {
  it("marks the scanner link opened from the board", () => {
    expect(scannerHrefFromBoard("/lop/c1/diem-danh/2026-10-12")).toBe("/lop/c1/diem-danh/2026-10-12/quet?from=board");
  });
});

describe("isFromBoard", () => {
  it("accepts only the exact marker", () => {
    expect(isFromBoard("board")).toBe(true);
    expect(isFromBoard(undefined)).toBe(false);
    expect(isFromBoard(["board"])).toBe(false);
    expect(isFromBoard("home")).toBe(false);
  });
});

describe("scannerExit", () => {
  it("goes back to the board entry when the scanner was opened from the board (no duplicate history entry)", () => {
    expect(scannerExit({ fromBoard: true, historyLength: 4 })).toBe("back");
  });
  it("replaces when opened from elsewhere (home quick action, direct URL)", () => {
    expect(scannerExit({ fromBoard: false, historyLength: 4 })).toBe("replace");
  });
  it("replaces when there is nothing to go back to (link opened in a fresh tab)", () => {
    expect(scannerExit({ fromBoard: true, historyLength: 1 })).toBe("replace");
  });
});
