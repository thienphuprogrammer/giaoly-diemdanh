import { describe, expect, it } from "vitest";
import { decideScan } from "./scan-rules";

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
