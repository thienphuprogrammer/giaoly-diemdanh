import type { Marks } from "./marks";

/** Các em chưa có dấu điểm danh (giữ thứ tự danh sách). */
export function unmarkedStudents<T extends { id: string }>(students: readonly T[], marks: Marks): T[] {
  return students.filter((s) => !marks[s.id]);
}

/**
 * Lý do chưa cho "Đánh vắng các em còn lại" (null = được phép). Phải đợi mọi lượt lưu/quét xong để danh sách
 * "chưa điểm danh" là thật và không tranh với lượt đang gửi.
 */
export function remainingAbsentBlock(args: { unsaved: number; busy: boolean; notReady?: boolean; deviceUnsent?: number }): string | null {
  if (args.notReady) return "Đang tải dữ liệu mới nhất, đợi một chút.";
  if (args.busy) return "Đang lưu một thao tác khác, đợi một chút.";
  // Lượt quét còn nằm trong hàng chờ của máy này (chưa tới máy chủ): các em đó trông như "chưa điểm danh" nhưng đã được quét.
  const device = args.deviceUnsent ?? 0;
  if (device > 0) return `Máy này còn ${device} lượt quét chưa gửi. Mở màn quét để gửi xong rồi mới đánh vắng, để không đánh vắng nhầm em đã quét.`;
  if (args.unsaved > 0) return `Còn ${args.unsaved} lượt chưa lưu xong. Đợi lưu xong (hoặc xử lý các lượt lỗi) rồi mới đánh vắng, để không ghi chồng lên lượt đang gửi.`;
  return null;
}

/** Lời nhắc trên bảng khi máy này còn lượt quét chưa gửi của buổi (null = không có). */
export function deviceUnsentNotice(count: number): string | null {
  return count > 0 ? `${count} lượt quét chưa gửi — mở màn quét để gửi` : null;
}
