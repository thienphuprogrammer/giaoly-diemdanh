/** Tên file tải về: NFC, chỉ giữ chữ (kể cả dấu kết hợp), số và ._-; không còn ký tự đường dẫn, nháy, xuống dòng. */
export function exportFilename(className: string, termName: string, prefix = "diem-danh"): string {
  const base = `${prefix}-${className}-${termName}`.normalize("NFC");
  const safe = base.replace(/[^\p{L}\p{M}\p{N}._-]+/gu, "-").replace(/^[.-]+/, "");
  return `${safe || prefix}.xlsx`;
}
