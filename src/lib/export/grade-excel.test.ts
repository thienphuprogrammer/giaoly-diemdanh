import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { GradeReport } from "@/server/services/term-report";
import { buildGradeWorkbook } from "./grade-excel";

const report: GradeReport = {
  gradeName: "Khối 1",
  term: { id: "t", name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" },
  classes: [
    { classId: "a", className: "Lớp A", studentCount: 3, sessions: 4, presentRate: 0.857, unexcusedWarnings: 1, massWarnings: 2, massWeeks: 5 },
    { classId: "b", className: "=Lớp B", studentCount: 0, sessions: 0, presentRate: null, unexcusedWarnings: 0, massWarnings: 0, massWeeks: 0 },
  ],
  warnings: [{ studentId: "s", fullName: "Nguyễn An", className: "Lớp A", unexcused: 2, missedMass: null }],
};

async function load() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await buildGradeWorkbook(report)) as unknown as ArrayBuffer);
  return wb;
}

describe("buildGradeWorkbook", () => {
  it("has the summary and warning sheets with per-class counts", async () => {
    const wb = await load();
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp khối", "Cảnh báo"]);
    const ws = wb.getWorksheet("Tổng hợp khối")!;
    expect(ws.getRow(2).values).toEqual([undefined, "Lớp A", 3, 4, 0.857, 1, 2, 5]);
    expect(ws.getRow(3).getCell(1).value).toBe("'=Lớp B");
    expect(ws.getRow(3).getCell(4).value).toBe("—");
    expect(ws.getRow(2).getCell(4).numFmt).toBe("0%");
    expect(String(ws.getCell("I1").value)).toContain("Học kỳ 1");
  });

  it("lists warned students, blank where that kind does not apply, and no phone/qr column", async () => {
    const wb = await load();
    const wr = wb.getWorksheet("Cảnh báo")!;
    expect(wr.getRow(2).getCell(2).value).toBe("Nguyễn An");
    expect(wr.getRow(2).getCell(4).value).toBe(2);
    expect(wr.getRow(2).getCell(5).value ?? "").toBe("");
    const all = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues())).toLowerCase();
    expect(all).not.toContain("điện thoại");
    expect(all).not.toContain("qr");
  });
});
