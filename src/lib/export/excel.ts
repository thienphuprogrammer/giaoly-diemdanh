import ExcelJS from "exceljs";
import type { StatRow } from "@/server/services/stats";

const FORMULA_START = /^[=+\-@\t\r]/;

/** Chống CSV/Excel formula injection: ô văn bản bắt đầu bằng = + - @ được chèn dấu nháy đơn. */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Thống kê";

const LEVEL_LABEL = { none: "", watch: "Cần chú ý", warning: "Cảnh báo" } as const;

export async function buildStatsWorkbook(input: { className: string; termName: string; rows: StatRow[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(input.className));
  ws.addRow(["STT", "Tên thánh", "Họ tên", "Có mặt", "Đi muộn", "Vắng có phép", "Vắng không phép", "Cảnh báo"]);
  ws.getRow(1).font = { bold: true };
  input.rows.forEach((r, i) => {
    const s = r.summary;
    ws.addRow([i + 1, safeCell(r.saintName ?? ""), safeCell(r.fullName), s.present, s.late, s.excused, s.unexcused, LEVEL_LABEL[s.warning.level]]);
  });
  [6, 14, 28, 10, 10, 14, 18, 12].forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  ws.getCell("J1").value = safeCell(`${input.className} — ${input.termName}`);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
