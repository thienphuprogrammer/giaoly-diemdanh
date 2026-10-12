/**
 * Cách rời màn quét về bảng điểm danh. Mở từ bảng (link "Quét QR" của bảng, có `?from=board`) thì lịch sử đã là
 * [..., bảng, máy quét]: lùi lại (`history.back`) để không tạo mục bảng thứ hai (Back sau đó sẽ "chết").
 * Mở từ nơi khác (nút nhanh ở trang chủ, gõ URL) thì thay mục máy quét bằng bảng (`replace`).
 */
export const FROM_BOARD = "board";

export const scannerHrefFromBoard = (boardHref: string): string => `${boardHref}/quet?from=${FROM_BOARD}`;

export const isFromBoard = (value: unknown): boolean => value === FROM_BOARD;

export function scannerExit({ fromBoard, historyLength }: { fromBoard: boolean; historyLength: number }): "back" | "replace" {
  // Tab mới mở thẳng link có `?from=board`: không có gì phía sau để lùi về.
  return fromBoard && historyLength > 1 ? "back" : "replace";
}
