import { describe, expect, it } from "vitest";
import { MAX_IMPORT_ROWS, parseStudentsCsv } from "./csv";

const HEADER = "Tên thánh,Họ tên,Ngày sinh,SĐT phụ huynh,Ghi chú";

describe("parseStudentsCsv", () => {
  it("parses a basic file", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\nPhêrô,Nguyễn Văn An,2015-03-04,0901234567,hay nói chuyện`);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ saintName: "Phêrô", fullName: "Nguyễn Văn An", birthDate: "2015-03-04", parentPhone: "0901234567", note: "hay nói chuyện" }]);
  });

  it("handles an Excel export: BOM, semicolons and CRLF", () => {
    const text = "﻿Tên thánh;Họ tên;Ngày sinh\r\nMaria;Trần Thu;04/03/2015\r\n";
    const { rows, errors } = parseStudentsCsv(text);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ fullName: "Trần Thu", birthDate: "2015-03-04" });
  });

  it("keeps commas, quotes and newlines inside quoted fields", () => {
    const { rows } = parseStudentsCsv(`${HEADER}\n,"Lê, Văn ""Bi""",,,"dòng 1\ndòng 2"`);
    expect(rows[0].fullName).toBe('Lê, Văn "Bi"');
    expect(rows[0].note).toBe("dòng 1\ndòng 2");
  });

  it("normalises decomposed (NFD) Vietnamese to NFC, including headers", () => {
    const nfd = "Nguyễn Văn An".normalize("NFD");
    const header = "Họ tên".normalize("NFD");
    const { rows, errors } = parseStudentsCsv(`${header}\n${nfd}`);
    expect(errors).toEqual([]);
    expect(rows[0].fullName).toBe("Nguyễn Văn An".normalize("NFC"));
  });

  it("accepts English or unaccented headers in any order", () => {
    const { rows } = parseStudentsCsv("phone,full_name\n0901234567,An");
    expect(rows[0]).toMatchObject({ fullName: "An", parentPhone: "0901234567" });
  });

  it("skips blank lines", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n\nPhêrô,An,,,\n,,,,\n`);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });

  it("reports row errors with their line number and keeps valid rows", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n,,2015-01-01,,\n,An,31/02/2015,,\n,Bình,,abc,\n,Chi,,,`);
    expect(rows.map((r) => r.fullName)).toEqual(["Chi"]);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(errors[0].message).toBe("Nhập họ tên");
  });

  it("flags duplicates within the file", () => {
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n,An,2015-01-01,,\n,an,2015-01-01,,`);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, message: "Trùng với dòng 2" }]);
  });

  it("errors when the name column is missing", () => {
    expect(parseStudentsCsv("Ngày sinh\n2015-01-01").errors).toEqual([{ line: 1, message: "Thiếu cột Họ tên" }]);
  });

  it("errors on an empty file and on an unterminated quote", () => {
    expect(parseStudentsCsv("").errors[0].line).toBe(0);
    expect(parseStudentsCsv(`${HEADER}\n,"An,,,`).errors[0].message).toContain("nháy");
  });

  it("refuses files over the row limit", () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `,Em ${i},,,`).join("\n");
    const { rows, errors } = parseStudentsCsv(`${HEADER}\n${body}`);
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain(String(MAX_IMPORT_ROWS));
  });
});
