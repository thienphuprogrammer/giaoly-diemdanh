import { studentFields, type StudentFields } from "@/lib/students/schema";

export const MAX_IMPORT_ROWS = 500;
export interface ImportError { line: number; message: string }

type Field = "fullName" | "saintName" | "birthDate" | "parentPhone" | "note";
const ALIASES: Record<string, Field> = {
  "ho ten": "fullName", "ho va ten": "fullName", ten: "fullName", fullname: "fullName", "full name": "fullName",
  "ten thanh": "saintName", saintname: "saintName", "saint name": "saintName",
  "ngay sinh": "birthDate", birthdate: "birthDate", "birth date": "birthDate",
  "sdt phu huynh": "parentPhone", sdt: "parentPhone", "so dien thoai": "parentPhone", phone: "parentPhone", "parent phone": "parentPhone",
  "ghi chu": "note", note: "note",
};

const normalizeHeader = (h: string) =>
  h.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/đ/g, "d").replace(/[_-]+/g, " ").trim();

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** Tách CSV theo RFC 4180 (ngoặc kép, "" thoát, xuống dòng trong ô). Ném lỗi nếu dấu nháy không đóng. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (src[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Dấu nháy kép không được đóng");
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function toIsoDate(value: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (!m) return value;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "invalid";
}

export function parseStudentsCsv(text: string): { rows: StudentFields[]; errors: ImportError[] } {
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (e) {
    return { rows: [], errors: [{ line: 0, message: (e as Error).message }] };
  }
  if (!records.some((r) => r.some((c) => c.trim() !== ""))) return { rows: [], errors: [{ line: 0, message: "File trống" }] };

  const columns = records[0].map((h) => ALIASES[normalizeHeader(h)]);
  if (!columns.includes("fullName")) return { rows: [], errors: [{ line: 1, message: "Thiếu cột Họ tên" }] };
  const body = records.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 0, message: `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập` }] };
  }

  const rows: StudentFields[] = [];
  const errors: ImportError[] = [];
  const seen = new Map<string, number>();
  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.every((c) => c.trim() === "")) return;
    const raw: Partial<Record<Field, string>> = {};
    columns.forEach((field, i) => { if (field) raw[field] = (cells[i] ?? "").normalize("NFC").trim(); });
    if (raw.birthDate) raw.birthDate = toIsoDate(raw.birthDate);
    const parsed = studentFields.safeParse(raw);
    if (!parsed.success) {
      errors.push({ line, message: raw.birthDate === "invalid" ? "Ngày sinh không hợp lệ" : parsed.error.issues[0].message });
      return;
    }
    const key = `${parsed.data.fullName.toLowerCase()}|${parsed.data.birthDate ?? ""}`;
    const first = seen.get(key);
    if (first) { errors.push({ line, message: `Trùng với dòng ${first}` }); return; }
    seen.set(key, line);
    rows.push(parsed.data);
  });
  return { rows, errors };
}
