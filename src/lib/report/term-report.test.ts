import { describe, expect, it } from "vitest";
import { attendanceRatio, buildReportRows, buildReportTotals, formatPercent, termRangeLabel, type ReportInput } from "./term-report";

const summary = (over: Partial<ReportInput["summary"]> = {}): ReportInput["summary"] => ({
  present: 0, late: 0, excused: 0, unexcused: 0, marked: 0, warning: { level: "none", unexcused: 0, remaining: 2 }, ...over,
});
const row = (over: Partial<ReportInput> = {}): ReportInput => ({
  studentId: "s1", fullName: "Nguyễn An", saintName: "Giuse", former: false, inactive: false, summary: summary(), ...over,
});
const mass = (over: Partial<NonNullable<ReportInput["mass"]>> = {}): NonNullable<ReportInput["mass"]> =>
  ({ recordedWeeksCounted: 0, attendedWeeks: 0, missedWeeks: 0, warning: false, ...over });

describe("formatPercent", () => {
  it("formats vi-VN percent, dash for null/NaN", () => {
    expect(formatPercent(0.857)).toBe("86%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.857, 1)).toBe("85,7%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("attendanceRatio", () => {
  it("counts present + late over marked; null without marks", () => {
    expect(attendanceRatio(summary({ present: 2, late: 1, excused: 1, marked: 4 }))).toBe(0.75);
    expect(attendanceRatio(summary())).toBeNull();
  });
});

describe("termRangeLabel", () => {
  it("renders dd/mm/yyyy range", () => {
    expect(termRangeLabel("2026-09-01", "2027-01-15")).toBe("01/09/2026 – 15/01/2027");
  });
});

describe("buildReportRows", () => {
  it("numbers rows, labels former/inactive students and shows dash for zero sessions", () => {
    const rows = buildReportRows([
      row({ studentId: "a", fullName: "An" }),
      row({ studentId: "b", fullName: "Bình", former: true, summary: summary({ present: 1, marked: 1 }) }),
      row({ studentId: "c", fullName: "Chi", inactive: true, saintName: null }),
    ]);
    expect(rows.map((r) => r.stt)).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ fullName: "An", saintName: "Giuse", percent: "—", mass: "—", warning: "" });
    expect(rows[1].fullName).toBe("Bình (đã lên lớp khác)");
    expect(rows[1].percent).toBe("100%");
    expect(rows[2]).toMatchObject({ fullName: "Chi (đã nghỉ)", saintName: "" });
    expect(JSON.stringify(rows)).not.toContain("NaN");
  });

  it("warns at exactly the unexcused threshold, not below it, and at the mass threshold", () => {
    const rows = buildReportRows([
      row({ studentId: "a", summary: summary({ unexcused: 2, marked: 2, warning: { level: "warning", unexcused: 2, remaining: 0 } }) }),
      row({ studentId: "b", summary: summary({ unexcused: 1, marked: 1, warning: { level: "watch", unexcused: 1, remaining: 1 } }) }),
      row({ studentId: "c", mass: mass({ recordedWeeksCounted: 3, attendedWeeks: 1, missedWeeks: 2, warning: true }) }),
      row({ studentId: "d", mass: mass({ recordedWeeksCounted: 3, attendedWeeks: 2, missedWeeks: 1, warning: false }) }),
      row({ studentId: "e", summary: summary({ unexcused: 2, marked: 2, warning: { level: "warning", unexcused: 2, remaining: 0 } }), mass: mass({ recordedWeeksCounted: 2, missedWeeks: 2, warning: true }) }),
    ]);
    expect(rows.map((r) => r.warning)).toEqual([
      "Chú ý (≥2 vắng KP)", "", "Vắng lễ ≥ ngưỡng", "", "Chú ý (≥2 vắng KP); Vắng lễ ≥ ngưỡng",
    ]);
    expect(rows[2].mass).toBe("1/3");
    expect(rows[3].mass).toBe("2/3");
  });
});

describe("buildReportTotals", () => {
  it("is empty-safe for zero students", () => {
    const t = buildReportTotals([]);
    expect(t).toEqual({ students: 0, present: 0, late: 0, excused: 0, unexcused: 0, percent: "—", mass: "—", warnings: 0 });
  });

  it("sums counts, overall percent, mass weeks and warned students", () => {
    const t = buildReportTotals([
      row({ studentId: "a", summary: summary({ present: 3, late: 1, excused: 0, unexcused: 0, marked: 4 }) }),
      row({ studentId: "b", summary: summary({ present: 1, excused: 1, unexcused: 2, marked: 4, warning: { level: "warning", unexcused: 2, remaining: 0 } }), mass: mass({ recordedWeeksCounted: 3, attendedWeeks: 1, missedWeeks: 2, warning: true }) }),
    ]);
    expect(t).toEqual({ students: 2, present: 4, late: 1, excused: 1, unexcused: 2, percent: "63%", mass: "1/3", warnings: 1 });
  });
});
