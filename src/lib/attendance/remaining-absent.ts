import type { Marks } from "./marks";

/** Các em chưa có dấu điểm danh (giữ thứ tự danh sách). */
export function unmarkedStudents<T extends { id: string }>(students: readonly T[], marks: Marks): T[] {
  return students.filter((s) => !marks[s.id]);
}

/**
 * Lý do chưa cho "Đánh vắng các em còn lại" (null = được phép). Phải đợi mọi lượt lưu/quét xong để danh sách
 * "chưa điểm danh" là thật và không tranh với lượt đang gửi.
 */
export function remainingAbsentBlock(args: { unsaved: number; busy: boolean; notReady?: boolean }): string | null {
  if (args.notReady) return "Đang tải dữ liệu mới nhất, đợi một chút.";
  if (args.busy) return "Đang lưu một thao tác khác, đợi một chút.";
  if (args.unsaved > 0) return `Còn ${args.unsaved} lượt chưa lưu xong. Đợi lưu xong (hoặc xử lý các lượt lỗi) rồi mới đánh vắng, để không ghi chồng lên lượt đang gửi.`;
  return null;
}
