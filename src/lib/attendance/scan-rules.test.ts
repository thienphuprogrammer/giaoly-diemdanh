import { describe, expect, it } from "vitest";
import { INVALID_CARD, SESSION_CANCELLED, decideScan, scanRefusal } from "./scan-rules";

const mark = (status: "present" | "late" | "absent_excused" | "absent_unexcused") => ({ status, reason: null });

describe("decideScan", () => {
  it("unmarked: records the scan mode", () => {
    expect(decideScan(null, "present")).toEqual({ kind: "apply", status: "present" });
    expect(decideScan(null, "late")).toEqual({ kind: "apply", status: "late" });
  });
  it("already present: never changes, even in late mode", () => {
    expect(decideScan(mark("present"), "present")).toEqual({ kind: "noop", reason: "already_present" });
    expect(decideScan(mark("present"), "late")).toEqual({ kind: "noop", reason: "already_present" });
  });
  it("already late: never changes and never asks", () => {
    expect(decideScan(mark("late"), "present")).toEqual({ kind: "noop", reason: "already_late" });
    expect(decideScan(mark("late"), "late")).toEqual({ kind: "noop", reason: "already_late" });
  });
  it("absent: asks to confirm, defaulting to the scan mode", () => {
    expect(decideScan(mark("absent_excused"), "present")).toEqual({ kind: "confirm", defaultStatus: "present", current: "absent_excused" });
    expect(decideScan(mark("absent_unexcused"), "late")).toEqual({ kind: "confirm", defaultStatus: "late", current: "absent_unexcused" });
  });
  it("absent + an explicit confirmation: applies the chosen status", () => {
    expect(decideScan(mark("absent_unexcused"), "present", "late")).toEqual({ kind: "apply", status: "late" });
    expect(decideScan(mark("absent_excused"), "late", "present")).toEqual({ kind: "apply", status: "present" });
  });
  it("a confirmation never overrides a non-absent mark", () => {
    expect(decideScan(mark("present"), "present", "late")).toEqual({ kind: "noop", reason: "already_present" });
    expect(decideScan(null, "present", "late")).toEqual({ kind: "apply", status: "present" });
  });
});

describe("shared scan messages", () => {
  it("has one invalid-card message for server and scanner", () => {
    expect(INVALID_CARD).toBe("Thẻ không dùng được cho lớp này");
  });
});

describe("scanRefusal (whole-session gate on the scanner)", () => {
  it("refuses every scan of a cancelled (holiday) session", () => {
    expect(scanRefusal({ cancelled: true })).toBe(SESSION_CANCELLED);
    expect(SESSION_CANCELLED).toBe("Buổi này nghỉ lễ — không điểm danh");
  });
  it("allows scans of a normal session and while the roster is still loading", () => {
    expect(scanRefusal({ cancelled: false })).toBeNull();
    expect(scanRefusal(null)).toBeNull();
  });
});
