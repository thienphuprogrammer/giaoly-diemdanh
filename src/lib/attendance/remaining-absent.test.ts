import { describe, expect, it } from "vitest";
import { remainingAbsentBlock, unmarkedStudents } from "./remaining-absent";

describe("unmarkedStudents", () => {
  const students = [{ id: "a", fullName: "An" }, { id: "b", fullName: "Bình" }, { id: "c", fullName: "Chi" }];
  it("lists students without a mark, keeping order", () => {
    expect(unmarkedStudents(students, { a: { status: "present", reason: null }, b: null }).map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("is empty when everyone has a mark", () => {
    expect(unmarkedStudents(students, { a: { status: "late", reason: null }, b: { status: "absent_excused", reason: null }, c: { status: "present", reason: null } })).toEqual([]);
  });
});

describe("remainingAbsentBlock", () => {
  it("is null when nothing is unsaved", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: false })).toBeNull();
  });
  it("explains why while saves or scans are unfinished", () => {
    expect(remainingAbsentBlock({ unsaved: 3, busy: false })).toMatch(/3 lượt/);
  });
  it("explains why while another bulk action runs", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: true })).toMatch(/đang lưu/i);
  });
  it("blocks while data is stale or not loaded", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: false, notReady: true })).not.toBeNull();
  });
});
