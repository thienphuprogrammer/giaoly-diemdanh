import { describe, expect, it } from "vitest";
import { addDays, addYears, defaultSchoolYear, startWindow, suggestSchoolYear, nextYearName, termsOverlap, validateTermRanges } from "./defaults";

describe("addYears", () => {
  it.each([
    ["2026-09-01", 1, "2027-09-01"],
    ["2027-01-15", 1, "2028-01-15"],
    ["2028-02-29", 1, "2029-02-28"], // năm sau không nhuận: lùi về 28/02
    ["2027-02-28", 1, "2028-02-28"], // năm sau nhuận: giữ nguyên 28/02
    ["2024-02-29", 4, "2028-02-29"],
    ["2026-12-31", 1, "2027-12-31"],
  ])("%s + %i year(s) = %s", (day, n, expected) => {
    expect(addYears(day, n)).toBe(expected);
  });

  it("throws on a date that does not exist", () => {
    expect(() => addYears("2027-02-30", 1)).toThrow();
    expect(() => addYears("not-a-date", 1)).toThrow();
  });
});

describe("nextYearName", () => {
  it.each([
    ["2026-2027", "2027-2028"],
    ["Năm học 2026 - 2027", "Năm học 2027 - 2028"],
    ["2026–2027", "2027–2028"],
    ["Năm học mới", ""],
    ["", ""],
  ])("%s -> %s", (name, expected) => {
    expect(nextYearName(name)).toBe(expected);
  });
});

describe("defaultSchoolYear", () => {
  it("shifts the previous year's two terms by one year and keeps their names", () => {
    const d = defaultSchoolYear({
      name: "2026-2027",
      terms: [
        { name: "Học kỳ 2", startsOn: "2027-01-16", endsOn: "2027-05-31" },
        { name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" },
      ],
    }, "2026-10-12");
    expect(d).toEqual({
      name: "2027-2028",
      term1: { name: "Học kỳ 1", startsOn: "2027-09-01", endsOn: "2028-01-15" },
      term2: { name: "Học kỳ 2", startsOn: "2028-01-16", endsOn: "2028-05-31" },
    });
  });

  it("is leap-day safe (a term ending on 29/02 ends on 28/02 next year)", () => {
    const d = defaultSchoolYear({
      name: "2027-2028",
      terms: [
        { name: "HK1", startsOn: "2027-09-01", endsOn: "2028-02-29" },
        { name: "HK2", startsOn: "2028-03-01", endsOn: "2028-06-30" },
      ],
    }, "2027-10-01");
    expect(d.term1).toEqual({ name: "HK1", startsOn: "2028-09-01", endsOn: "2029-02-28" });
    expect(d.term2).toEqual({ name: "HK2", startsOn: "2029-03-01", endsOn: "2029-06-30" });
    expect(validateTermRanges(d.term1, d.term2)).toBeNull();
  });

  it("without a previous year (or with fewer than two terms) proposes September to May after today", () => {
    const expected = {
      name: "2027-2028",
      term1: { name: "Học kỳ 1", startsOn: "2027-09-01", endsOn: "2028-01-15" },
      term2: { name: "Học kỳ 2", startsOn: "2028-01-16", endsOn: "2028-05-31" },
    };
    expect(defaultSchoolYear(null, "2026-10-12")).toEqual(expected);
    expect(defaultSchoolYear({ name: "x", terms: [{ name: "a", startsOn: "2026-09-01", endsOn: "2027-01-15" }] }, "2026-10-12")).toEqual(expected);
    // Trước tháng 9: năm học bắt đầu ngay tháng 9 năm nay.
    expect(defaultSchoolYear(null, "2027-06-01").term1.startsOn).toBe("2027-09-01");
  });
});

describe("validateTermRanges", () => {
  const t = (startsOn: string, endsOn: string) => ({ name: "HK", startsOn, endsOn });

  it("accepts two consecutive terms", () => {
    expect(validateTermRanges(t("2027-09-01", "2028-01-15"), t("2028-01-16", "2028-05-31"))).toBeNull();
  });

  it.each([
    [t("2027-09-01", "2027-08-31"), t("2028-01-16", "2028-05-31"), /Học kỳ 1/],
    [t("2027-09-01", "2028-01-15"), t("2028-05-31", "2028-01-16"), /Học kỳ 2/],
    [t("2027-09-01", "2028-01-15"), t("2028-01-15", "2028-05-31"), /sau/],
    [t("2027-09-01", "2028-01-15"), t("2027-10-01", "2027-12-31"), /sau/],
  ])("refuses bad ranges", (a, b, msg) => {
    expect(validateTermRanges(a, b)).toMatch(msg);
  });

  it("refuses a year longer than 400 days", () => {
    expect(validateTermRanges(t("2027-09-01", "2028-01-15"), t("2028-01-16", "2028-12-31"))).toMatch(/dài/);
  });
});

describe("termsOverlap", () => {
  const t = (startsOn: string, endsOn: string) => ({ startsOn, endsOn });
  it.each([
    [t("2027-09-01", "2028-01-15"), t("2027-01-16", "2027-05-31"), false],
    [t("2027-05-31", "2027-06-30"), t("2027-01-16", "2027-05-31"), true], // trùng đúng một ngày
    [t("2027-01-01", "2027-12-31"), t("2027-03-01", "2027-04-01"), true], // bao trọn
    [t("2027-03-01", "2027-04-01"), t("2027-01-01", "2027-12-31"), true],
  ])("%o vs %o -> %s", (a, b, expected) => {
    expect(termsOverlap(a, b)).toBe(expected);
  });
});

describe("addDays / startWindow", () => {
  it("adds and subtracts days across months and leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("allows a start between 400 days before and 550 days after today", () => {
    expect(startWindow("2026-10-12")).toEqual({ min: "2025-09-07", max: "2028-04-14" });
  });
});

describe("suggestSchoolYear (form defaults always inside the start window)", () => {
  const year = (name: string, start: number) => ({
    name, terms: [
      { name: "HK1", startsOn: `${start}-09-01`, endsOn: `${start + 1}-01-15` },
      { name: "HK2", startsOn: `${start + 1}-01-16`, endsOn: `${start + 1}-05-31` },
    ],
  });
  it("keeps the shifted previous year when it starts inside the window", () => {
    expect(suggestSchoolYear(year("2026-2027", 2026), "2026-10-12").term1.startsOn).toBe("2027-09-01");
  });
  it("falls back to the coming September when the latest year is very old", () => {
    expect(suggestSchoolYear(year("2019-2020", 2019), "2026-10-12")).toEqual(defaultSchoolYear(null, "2026-10-12"));
  });
  it("falls back to the coming September when next year was already created early (shift would be too far)", () => {
    const d = suggestSchoolYear(year("2027-2028", 2027), "2026-10-12");
    expect(d.term1.startsOn).toBe("2027-09-01");
    const w = startWindow("2026-10-12");
    expect(d.term1.startsOn >= w.min && d.term1.startsOn <= w.max).toBe(true);
  });
  it("on the window's last day the shifted start is still accepted", () => {
    // 2027-09-01 + 0: hôm nay = 2027-09-01 - 550 ngày
    expect(suggestSchoolYear(year("2026-2027", 2026), addDays("2027-09-01", -550)).term1.startsOn).toBe("2027-09-01");
    expect(suggestSchoolYear(year("2026-2027", 2026), addDays("2027-09-01", -551)).term1.startsOn).not.toBe("2027-09-01");
  });
});
