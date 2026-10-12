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

/**
 * Quy tắc DUY NHẤT gắn nhãn một em trong số liệu của một lớp (thống kê, sheet Excel lớp và đi lễ, tổng quan khối):
 * - `former`: lớp HIỆN TẠI của em khác lớp đã tổ chức buổi (em đã lên lớp/chuyển lớp), nhãn "(đã lên lớp khác)";
 * - `inactive`: em vẫn ở lớp đó nhưng đã nghỉ học (nhãn "(đã nghỉ)"; chỉ gặp ở học kỳ đã qua).
 * Danh sách cần hành động (trang chủ, "Cần chú ý") bỏ cả hai loại.
 */
export interface Membership { former: boolean; inactive: boolean }
export function membershipOf(student: { currentClassId: string; active: boolean }, statsClassId: string): Membership {
  const former = student.currentClassId !== statsClassId;
  return { former, inactive: !former && !student.active };
}
export const isActionable = (m: Membership): boolean => !m.former && !m.inactive;

/** Chữ ghi sau tên em trong bảng thống kê/Excel; chuỗi rỗng khi em đang học ở lớp. */
export function membershipNote(m: Membership): string {
  if (m.former) return "(đã lên lớp khác)";
  return m.inactive ? "(đã nghỉ)" : "";
}
