import { describe, expect, it } from "vitest";
import type { Marks } from "./marks";
import { unmarkedStudents } from "./remaining-absent";
import { filterAttendanceRoster } from "./roster-view-filter";

const students = [
  { id: "an", fullName: "Nguyễn Văn An", saintName: "Phêrô" },
  { id: "dung", fullName: "Trần Thị Dũng", saintName: null },
  { id: "binh", fullName: "Lê Đức Bình", saintName: "Maria" },
];

describe("filterAttendanceRoster", () => {
  it("shows the complete roster in its original order when search is empty", () => {
    expect(filterAttendanceRoster(students, {}, "  ", "all")).toEqual(students);
  });

  it("matches names without accents and matches saint names", () => {
    expect(filterAttendanceRoster(students, {}, "DUNG", "all").map((s) => s.id)).toEqual(["dung"]);
    expect(filterAttendanceRoster(students, {}, "nguyen an", "all").map((s) => s.id)).toEqual(["an"]);
    expect(filterAttendanceRoster(students, {}, "maria", "all").map((s) => s.id)).toEqual(["binh"]);
  });

  it("shows all matching students instead of the scanner's eight-result limit", () => {
    const largeRoster = Array.from({ length: 15 }, (_, index) => ({ id: `${index}`, fullName: `Nguyễn An ${index}`, saintName: null }));
    expect(filterAttendanceRoster(largeRoster, {}, "nguyen", "all")).toEqual(largeRoster);
  });

  it("combines search with unmarked status, treating every saved status as marked", () => {
    const marks: Marks = { an: { status: "late", reason: null }, dung: { status: "absent_excused", reason: "Có phép" }, binh: null };
    expect(filterAttendanceRoster(students, marks, "", "unmarked").map((s) => s.id)).toEqual(["binh"]);
    expect(filterAttendanceRoster(students, marks, "maria", "unmarked").map((s) => s.id)).toEqual(["binh"]);
    expect(filterAttendanceRoster(students, marks, "an", "unmarked")).toEqual([]);
  });

  it("updates the unmarked view when a mark is saved or removed", () => {
    expect(filterAttendanceRoster(students, { an: { status: "present", reason: null } }, "an nguyen", "unmarked")).toEqual([]);
    expect(filterAttendanceRoster(students, { an: null }, "an nguyen", "unmarked").map((s) => s.id)).toEqual(["an"]);
  });

  it("preserves the full roster and marks used by class-wide actions", () => {
    const marks: Marks = { an: { status: "present", reason: null }, dung: null, binh: null };
    const originalMarks = structuredClone(marks);
    const originalStudents = structuredClone(students);
    expect(filterAttendanceRoster(students, marks, "dung", "unmarked").map((s) => s.id)).toEqual(["dung"]);
    expect(unmarkedStudents(students, marks).map((s) => s.id)).toEqual(["dung", "binh"]);
    expect(students).toEqual(originalStudents);
    expect(marks).toEqual(originalMarks);
  });

  it("returns an empty result when no name matches", () => {
    expect(filterAttendanceRoster(students, {}, "khong co", "all")).toEqual([]);
  });
});
