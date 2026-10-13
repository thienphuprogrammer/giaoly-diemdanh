import { describe, expect, it } from "vitest";
import { compareByGivenName, sortByGivenName, splitName } from "./name";

describe("splitName", () => {
  it("takes the last word as the given name and the rest as family + middle name", () => {
    expect(splitName("Nguyễn Huỳnh Khả Ái")).toEqual({ family: "Nguyễn Huỳnh Khả", given: "Ái" });
    expect(splitName("Trần Hoàng An")).toEqual({ family: "Trần Hoàng", given: "An" });
  });

  it("handles a single word, extra spaces and decomposed Unicode", () => {
    expect(splitName("An")).toEqual({ family: "", given: "An" });
    expect(splitName("  Phạm   Anh  Tú ")).toEqual({ family: "Phạm Anh", given: "Tú" });
    expect(splitName("Nguyễn An")).toEqual({ family: "Nguyễn", given: "An" });
  });

  it("returns empty parts for a blank name", () => {
    expect(splitName("   ")).toEqual({ family: "", given: "" });
  });
});

describe("compareByGivenName", () => {
  const order = (names: string[]) => sortByGivenName(names.map((fullName) => ({ fullName }))).map((s) => s.fullName);

  it("sorts by given name first, not by family name", () => {
    expect(order(["Trần Hoàng An", "Nguyễn Văn Bình", "Hoàng Hồng Hoài An", "Vũ Tuấn Tú", "Lê Thị Cúc"])).toEqual([
      "Hoàng Hồng Hoài An", "Trần Hoàng An", "Nguyễn Văn Bình", "Lê Thị Cúc", "Vũ Tuấn Tú",
    ]);
  });

  it("breaks ties by the family + middle name", () => {
    expect(order(["Vũ Minh An", "Đỗ Anh An", "Bùi An An"])).toEqual(["Bùi An An", "Đỗ Anh An", "Vũ Minh An"]);
  });

  it("follows Vietnamese alphabetical order for accented given names", () => {
    expect(order(["Lê Văn Ân", "Lê Văn Ba", "Lê Văn Ăn", "Lê Văn Anh", "Lê Văn Ái"])).toEqual([
      "Lê Văn Ái", "Lê Văn Anh", "Lê Văn Ăn", "Lê Văn Ân", "Lê Văn Ba",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [{ fullName: "B Z" }, { fullName: "A Y" }];
    sortByGivenName(input);
    expect(input.map((s) => s.fullName)).toEqual(["B Z", "A Y"]);
  });

  it("is a consistent comparator", () => {
    expect(compareByGivenName("Lê An", "Lê An")).toBe(0);
    expect(Math.sign(compareByGivenName("Lê An", "Lê Bình"))).toBe(-Math.sign(compareByGivenName("Lê Bình", "Lê An")));
  });
});
