import ExcelJS from "exceljs";
import type { MassCell } from "@/lib/attendance/mass-tally";
import { shortDate } from "@/lib/date-label";
import type { MassStats } from "@/server/services/mass-stats";
import type { StatRow } from "@/server/services/stats";

const FORMULA_START = /^[=+\-@\t\r]/;

/** Chống CSV/Excel formula injection: ô văn bản bắt đầu bằng = + - @ được chèn dấu nháy đơn. */
export function safeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Thống kê";

/** Em đã lên lớp khác vẫn có trong số liệu học kỳ đã qua của lớp cũ: ghi chú ngay sau tên. */
const nameOf = (r: { fullName: string; former: boolean }) => safeCell(r.former ? `${r.fullName} (đã lên lớp khác)` : r.fullName);

const LEVEL_LABEL = { none: "", watch: "Cần chú ý", warning: "Cảnh báo" } as const;

const MASS_SHEET = "Đi lễ";
const MASS_MARK: Record<MassCell, string> = { attended: "✓", missed: "✗", not_counted: "—" };

type MassSheet = Pick<MassStats, "threshold" | "weeks" | "rows">;

/** Sheet riêng "Đi lễ" (spec §1b): mỗi em một dòng, mỗi tuần đã ghi nhận một cột, cộng tổng và cảnh báo. */
function addMassSheet(wb: ExcelJS.Workbook, classSheet: string, mass: MassSheet) {
  const name = classSheet.toLocaleLowerCase("vi") === MASS_SHEET.toLocaleLowerCase("vi") ? `${MASS_SHEET} (thống kê)` : MASS_SHEET;
  const ws = wb.addWorksheet(name);
  const sum = (pick: (r: MassSheet["rows"][number]) => number) => mass.rows.reduce((n, r) => n + pick(r), 0);
  ws.addRow(["STT", "Tên thánh", "Họ tên", ...mass.weeks.map((w) => shortDate(w.heldOn)), "Tuần đã tính", "Đi lễ", "Vắng lễ", "Cảnh báo"]);
  ws.getRow(1).font = { bold: true };
  mass.rows.forEach((r, i) => {
    ws.addRow([i + 1, safeCell(r.saintName ?? ""), nameOf(r), ...r.cells.map((c) => MASS_MARK[c]),
      r.recordedWeeksCounted, r.attendedWeeks, r.missedWeeks, r.warning ? "Cảnh báo" : ""]);
  });
  const total = ws.addRow(["", "", "Tổng", ...mass.weeks.map((_, w) => mass.rows.filter((r) => r.cells[w] === "attended").length),
    sum((r) => r.recordedWeeksCounted), sum((r) => r.attendedWeeks), sum((r) => r.missedWeeks), `${mass.rows.filter((r) => r.warning).length} cảnh báo`]);
  total.font = { bold: true };
  ws.addRow([]);
  ws.addRow([`Cảnh báo khi vắng lễ từ ${mass.threshold} tuần trong học kỳ. ✓ đi lễ · ✗ vắng lễ · — chưa tính (trước buổi đầu tiên em có tên ở lớp). Chỉ tính tuần đã ghi nhận, không tính tuần không có lễ.`]);
  [6, 14, 28, ...mass.weeks.map(() => 11), 12, 8, 9, 12].forEach((width, i) => { ws.getColumn(i + 1).width = width; });
}

export async function buildStatsWorkbook(input: { className: string; termName: string; rows: StatRow[]; mass?: MassSheet }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(input.className));
  ws.addRow(["STT", "Tên thánh", "Họ tên", "Có mặt", "Đi muộn", "Vắng có phép", "Vắng không phép", "Cảnh báo"]);
  ws.getRow(1).font = { bold: true };
  input.rows.forEach((r, i) => {
    const s = r.summary;
    ws.addRow([i + 1, safeCell(r.saintName ?? ""), nameOf(r), s.present, s.late, s.excused, s.unexcused, LEVEL_LABEL[s.warning.level]]);
  });
  [6, 14, 28, 10, 10, 14, 18, 12].forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  ws.getCell("J1").value = safeCell(`${input.className} — ${input.termName}`);
  if (input.mass) addMassSheet(wb, ws.name, input.mass);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
