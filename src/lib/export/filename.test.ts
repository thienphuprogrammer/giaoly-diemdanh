import { describe, expect, it } from "vitest";
import { exportFilename } from "./filename";

describe("exportFilename", () => {
  it("keeps Unicode letters and combining marks of NFD input", () => {
    const name = exportFilename("Lớp A".normalize("NFD"), "Học kỳ 1".normalize("NFD"));
    expect(name).toBe("diem-danh-Lớp-A-Học-kỳ-1.xlsx".normalize("NFC"));
  });
  it("removes path separators, quotes and line breaks", () => {
    const name = exportFilename('A/B\\"C\r\nD', "x\ty");
    expect(name).toMatch(/^[\p{L}\p{M}\p{N}._-]+$/u);
    expect(name).not.toMatch(/[/\\"\r\n]/);
    expect(name.endsWith(".xlsx")).toBe(true);
  });
});
