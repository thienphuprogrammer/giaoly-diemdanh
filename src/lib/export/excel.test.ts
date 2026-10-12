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

describe("buildStatsWorkbook: Đi lễ sheet", () => {
  const classRows = [
    { studentId: "1", classId: "c", fullName: "An", saintName: "Phêrô", summary: summarize([{ status: "present" }]) },
  ];
  const mass = {
    threshold: 2,
    weeks: [{ sessionId: "w1", heldOn: "2026-10-04" }, { sessionId: "w2", heldOn: "2026-10-11" }],
    rows: [
      { studentId: "1", fullName: "An", saintName: "Phêrô", recordedWeeksCounted: 2, attendedWeeks: 0, missedWeeks: 2, warning: true, cells: ["missed", "missed"] as const },
      { studentId: "2", fullName: "+Bình", saintName: null, recordedWeeksCounted: 1, attendedWeeks: 1, missedWeeks: 0, warning: false, cells: ["not_counted", "attended"] as const },
    ],
  };
  const load = async (buffer: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    return wb;
  };

  it("adds a separate 'Đi lễ' sheet (✓/✗/— per recorded week, totals, warning) and keeps the class sheet unchanged", async () => {
    const without = await load(await buildStatsWorkbook({ className: "Lớp A", termName: "Học kỳ 1", rows: classRows }));
    const withMass = await load(await buildStatsWorkbook({ className: "Lớp A", termName: "Học kỳ 1", rows: classRows, mass }));
    expect(withMass.worksheets.map((w) => w.name)).toEqual(["Lớp A", "Đi lễ"]);
    const values = (wb: ExcelJS.Workbook) => { const v: unknown[] = []; wb.worksheets[0].eachRow((r) => v.push(r.values)); return v; };
    expect(values(withMass)).toEqual(values(without));

    const ws = withMass.getWorksheet("Đi lễ")!;
    const row = (n: number) => (ws.getRow(n).values as unknown[]).slice(1);
    expect(row(1)).toEqual(["STT", "Tên thánh", "Họ tên", "04/10/2026", "11/10/2026", "Tuần đã tính", "Đi lễ", "Vắng lễ", "Cảnh báo"]);
    expect(row(2)).toEqual([1, "Phêrô", "An", "✗", "✗", 2, 0, 2, "Cảnh báo"]);
    expect(row(3)).toEqual([2, "", "'+Bình", "—", "✓", 1, 1, 0, ""]);
    expect(row(4)).toEqual(["", "", "Tổng", 0, 1, 3, 1, 2, "1 cảnh báo"]);
    const legend = ws.getRow(6).getCell(1).value as string;
    expect(legend).toContain("vắng lễ từ 2 tuần");
    expect(legend).toContain("✓ đi lễ");
  });

  it("names the Mass sheet so it never collides with a class literally called 'Đi lễ'", async () => {
    const wb = await load(await buildStatsWorkbook({ className: "Đi lễ", termName: "HK1", rows: classRows, mass }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Đi lễ", "Đi lễ (thống kê)"]);
  });
});
