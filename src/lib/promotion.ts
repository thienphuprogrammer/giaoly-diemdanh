/** Hằng số/câu chữ dùng chung giữa service lên lớp (server) và màn hình (client). */

/** Mỗi lần lên lớp chuyển tối đa chừng này em. */
export const MAX_PROMOTION = 200;

/** Danh sách em trên màn hình đã cũ (em đã nghỉ/chuyển lớp khác): màn hình tải lại danh sách khi gặp lỗi này. */
export const STALE_PROMOTION = "Có em không còn ở lớp nguồn hoặc đã nghỉ học. Tải lại danh sách rồi thử lại.";

/** Hệ quả nói rõ trước khi xác nhận. */
export const PROMOTION_CONSEQUENCES = "Giữ thẻ QR và lịch sử điểm danh. Chỗ ngồi cũ sẽ bị xoá. Có thể hoàn tác trong 24 giờ.";

/** Điểm danh cũ ở lớp nguồn (kể cả hôm nay) ở lại lớp nguồn và không sửa được cho các em sau khi chuyển. */
export const PROMOTION_HISTORY_NOTE =
  "Điểm danh đã ghi ở lớp cũ (kể cả hôm nay) vẫn thuộc lớp cũ; sau khi chuyển, không sửa được điểm danh cũ của các em ở lớp cũ nữa.";
