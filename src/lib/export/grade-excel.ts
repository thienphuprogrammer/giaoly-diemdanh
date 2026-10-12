import ExcelJS from "exceljs";
import { safeCell } from "@/lib/export/excel";
import { formatPercent, termRangeLabel } from "@/lib/report/term-report";
import type { GradeReport } from "@/server/services/term-report";

const SUMMARY = "Tổng hợp khối";
const WARNINGS = "Cảnh báo";

/** Workbook tổng hợp khối: sheet "Tổng hợp khối" (mỗi lớp một dòng) và "Cảnh báo" (em đang cảnh báo, không có SĐT). */
export async function buildGradeWorkbook(report: GradeReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SUMMARY);
  ws.addRow(["Lớp", "Sĩ số", "Số buổi học đã tổ chức", "% có mặt", "Em cảnh báo vắng KP", "Em cảnh báo vắng lễ", "Số tuần lễ đã ghi"]);
  ws.getRow(1).font = { bold: true };
  for (const c of report.classes) {
    ws.addRow([safeCell(c.className), c.studentCount, c.sessions, formatPercent(c.presentRate), c.unexcusedWarnings, c.massWarnings, c.massWeeks]);
  }
  ws.getCell("I1").value = safeCell(`${report.gradeName} — ${report.term.name} (${termRangeLabel(report.term.startsOn, report.term.endsOn)})`);
  [22, 8, 22, 10, 20, 20, 16].forEach((width, i) => { ws.getColumn(i + 1).width = width; });

  const wr = wb.addWorksheet(WARNINGS);
  wr.addRow(["STT", "Họ tên", "Lớp", "Vắng không phép (buổi)", "Vắng lễ (tuần)"]);
  wr.getRow(1).font = { bold: true };
  report.warnings.forEach((w, i) => {
    wr.addRow([i + 1, safeCell(w.fullName), safeCell(w.className), w.unexcused ?? "", w.missedMass ?? ""]);
  });
  [6, 28, 22, 24, 16].forEach((width, i) => { wr.getColumn(i + 1).width = width; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
