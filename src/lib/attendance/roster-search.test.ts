import { describe, expect, it } from "vitest";
import { filterRoster } from "./roster-search";

const roster = [
  { fullName: "Nguyễn Văn An", saintName: "Phêrô" },
  { fullName: "Trần Thị Dũng", saintName: null },
  { fullName: "Lê Đức Bình", saintName: "Maria" },
];

describe("filterRoster", () => {
  it("ignores accents, case and đ", () => {
    expect(filterRoster(roster, "nguyen").map((r) => r.fullName)).toEqual(["Nguyễn Văn An"]);
    expect(filterRoster(roster, "DUNG").map((r) => r.fullName)).toEqual(["Trần Thị Dũng"]);
    expect(filterRoster(roster, "duc").map((r) => r.fullName)).toEqual(["Lê Đức Bình"]);
  });
  it("matches words in any order and the saint name", () => {
    expect(filterRoster(roster, "an nguyen")).toHaveLength(1);
    expect(filterRoster(roster, "maria")[0].fullName).toBe("Lê Đức Bình");
  });
  it("returns nothing for an empty query and honours the limit", () => {
    expect(filterRoster(roster, "  ")).toEqual([]);
    expect(filterRoster(roster, "a", 2)).toHaveLength(2);
  });
});
