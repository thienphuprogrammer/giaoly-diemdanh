import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/attendance/summary";
import { buildStatsWorkbook, safeCell } from "./excel";

describe("safeCell", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const v of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) expect(safeCell(v)).toBe(`'${v}`);
  });
  it("leaves ordinary names alone", () => {
    expect(safeCell("Nguyễn Văn An")).toBe("Nguyễn Văn An");
    expect(safeCell("")).toBe("");
  });
});

describe("buildStatsWorkbook", () => {
  it("writes a header, one row per student and sanitises text cells", async () => {
    const rows = [
      { studentId: "1", classId: "c", fullName: "=HYPERLINK(\"http://x\")", saintName: "Phêrô", summary: summarize([{ status: "present" }, { status: "absent_unexcused" }, { status: "absent_unexcused" }]) },
      { studentId: "2", classId: "c", fullName: "Trần Bình", saintName: null, summary: summarize([]) },
    ];
    const buffer = await buildStatsWorkbook({ className: "Lớp A/B?", termName: "Học kỳ 1", rows });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe("Lớp A B");
    expect(ws.getRow(1).values).toContain("Họ tên");
    expect(ws.getRow(2).getCell(3).value).toBe("'=HYPERLINK(\"http://x\")");
    expect(ws.getRow(2).getCell(7).value).toBe(2); // vắng không phép
    expect(ws.getRow(2).getCell(8).value).toBe("Cảnh báo");
    expect(ws.getRow(3).getCell(8).value ?? "").toBe("");
  });
});
