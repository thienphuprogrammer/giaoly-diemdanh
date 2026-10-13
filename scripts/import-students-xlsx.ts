import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { classes, grades, schoolYears, students } from "../src/db/schema";
import type { Db } from "../src/db/types";
import { databaseUrlFromEnv, postgresOptionsFromEnv, sanitizeDatabaseUrl } from "../src/db/connection-options";
import { studentFields } from "../src/lib/students/schema";
import { recordAudit } from "../src/server/audit";

/** Bounded, credential-free messages that are safe to show the operator. */
class OperatorError extends Error {}
class DryRunRollback extends Error {}

interface ClassSheet { className: string; rows: Array<{ saintName: string; fullName: string; note: string }> }

const APPLY_FLAG = "--apply";
const CREATE_GRADE_FLAG = "--create-grade";
const DEFAULT_GRADE = "Ấu Nhi 2";
const DEFAULT_YEAR = "2026-2027";

const text = (value: ExcelJS.CellValue | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "richText" in value) return value.richText.map((part) => part.text).join("");
  return String(value);
};
const clean = (value: ExcelJS.CellValue | undefined): string => text(value).normalize("NFC").replace(/\s+/g, " ").trim();

function parseSheet(ws: ExcelJS.Worksheet): ClassSheet {
  let className = "";
  let headerRow = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const first = clean(ws.getRow(r).getCell(1).value);
    const m = /^DANH SÁCH LỚP\s+(.+)$/iu.exec(first);
    if (m && !className) className = m[1].replace(/\s+/g, " ").trim().normalize("NFC");
    if (first.toUpperCase() === "STT") { headerRow = r; break; }
  }
  if (!className || !headerRow) throw new OperatorError(`Sheet "${ws.name}": không nhận ra tiêu đề lớp hoặc dòng STT`);
  const rows: ClassSheet["rows"] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!/^\d+$/.test(clean(row.getCell(1).value))) continue; // trailing totals and signature lines
    const fullName = [clean(row.getCell(3).value), clean(row.getCell(4).value)].filter(Boolean).join(" ");
    const oldClass = clean(row.getCell(5).value);
    const extra = clean(row.getCell(6).value);
    const note = [oldClass && `Lớp cũ: ${oldClass}`, extra].filter(Boolean).join("; ");
    rows.push({ saintName: clean(row.getCell(2).value), fullName, note });
  }
  return { className, rows };
}

const key = (name: string) => name.normalize("NFC").trim().toLowerCase();

async function main(): Promise<void> {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new OperatorError("Cách dùng: pnpm import:students <file.xlsx> [--create-grade] [--apply]");
  const apply = process.argv.slice(2).includes(APPLY_FLAG);
  const createGrade = process.argv.slice(2).includes(CREATE_GRADE_FLAG);
  const gradeName = process.env.GRADE_NAME ?? DEFAULT_GRADE;
  const yearName = process.env.YEAR_NAME ?? DEFAULT_YEAR;
  const url = databaseUrlFromEnv(process.env);
  if (!url) throw new OperatorError("Thiếu DATABASE_URL hoặc DATABASE_URL_UNPOOLED");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheets = workbook.worksheets.map(parseSheet);
  for (const sheet of sheets) {
    sheet.rows.forEach((row, i) => {
      const parsed = studentFields.safeParse(row.note ? row : { ...row, note: undefined });
      if (!parsed.success) throw new OperatorError(`${sheet.className}, em thứ ${i + 1}: ${parsed.error.issues[0]?.message ?? "dữ liệu không hợp lệ"}`);
    });
  }

  const connection = postgres(sanitizeDatabaseUrl(url), postgresOptionsFromEnv(process.env));
  try {
    const db = drizzle(connection, { schema }) as unknown as Db;
    const report: string[] = [];
    try {
      await db.transaction(async (tx) => {
        let [grade] = await tx.select({ id: grades.id }).from(grades).where(eq(grades.name, gradeName));
        if (!grade && createGrade) {
          [grade] = await tx.insert(grades).values({ name: gradeName }).returning({ id: grades.id });
          await recordAudit(tx, { actorId: null, gradeId: grade.id, entity: "grade", entityId: grade.id, action: "grade.create", summary: { gradeName } });
          report.push(`Khối "${gradeName}": tạo mới (chưa có trưởng khối; gán trong khu quản trị)`);
        }
        if (!grade) {
          const names = (await tx.select({ name: grades.name }).from(grades)).map((g) => g.name).join(", ") || "(chưa có khối nào)";
          throw new OperatorError(`Không có khối "${gradeName}". Các khối hiện có: ${names}. Thêm ${CREATE_GRADE_FLAG} để tạo khối, hoặc đặt GRADE_NAME.`);
        }
        const [year] = await tx.select({ id: schoolYears.id }).from(schoolYears).where(eq(schoolYears.name, yearName));
        if (!year) {
          const names = (await tx.select({ name: schoolYears.name }).from(schoolYears)).map((y) => y.name).join(", ") || "(chưa có năm học nào)";
          throw new OperatorError(`Không có năm học "${yearName}". Các năm hiện có: ${names}. Tạo năm học trước hoặc đặt YEAR_NAME.`);
        }
        for (const sheet of sheets) {
          let [cls] = await tx.select({ id: classes.id }).from(classes)
            .where(and(eq(classes.gradeId, grade.id), eq(classes.schoolYearId, year.id), eq(classes.name, sheet.className)));
          const created = !cls;
          if (!cls) {
            [cls] = await tx.insert(classes).values({ gradeId: grade.id, schoolYearId: year.id, name: sheet.className }).returning({ id: classes.id });
            await recordAudit(tx, { actorId: null, gradeId: grade.id, entity: "class", entityId: cls.id, action: "class.create", summary: { className: sheet.className, yearName } });
          }
          const existing = new Set((await tx.select({ fullName: students.fullName }).from(students).where(eq(students.classId, cls.id))).map((s) => key(s.fullName)));
          const seen = new Set<string>();
          const fresh = sheet.rows.filter((r) => { const k = key(r.fullName); if (existing.has(k) || seen.has(k)) return false; seen.add(k); return true; });
          if (fresh.length > 0) {
            await tx.insert(students).values(fresh.map((r) => ({ classId: cls.id, saintName: r.saintName || null, fullName: r.fullName, note: r.note || null })));
            await recordAudit(tx, { actorId: null, classId: cls.id, entity: "student", action: "student.import", summary: { count: fresh.length, skipped: sheet.rows.length - fresh.length } });
          }
          report.push(`${sheet.className}: ${created ? "tạo lớp mới" : "lớp đã có"}, thêm ${fresh.length}, bỏ qua ${sheet.rows.length - fresh.length} (file có ${sheet.rows.length} em)`);
        }
        if (!apply) throw new DryRunRollback();
      });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }
    console.log(report.join("\n"));
    console.log(apply ? "\nĐÃ GHI vào cơ sở dữ liệu." : `\nCHẠY THỬ: chưa ghi gì. Thêm ${APPLY_FLAG} để ghi thật.`);
  } finally {
    await connection.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  // Only operator-facing messages are printed; driver errors may embed connection details.
  console.error(error instanceof OperatorError ? error.message : "Nhập danh sách thất bại (lỗi không mong đợi, không in chi tiết để tránh lộ chuỗi kết nối)");
  process.exit(1);
});
