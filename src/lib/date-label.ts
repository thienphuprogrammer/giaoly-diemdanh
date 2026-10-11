const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"] as const;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-11" -> "Chủ nhật, 11/10/2026". Chỉ dùng để hiển thị; chuỗi không hợp lệ được trả lại nguyên vẹn. */
export function dateLabel(isoDay: string): string {
  const match = ISO_DAY.exec(isoDay);
  if (!match) return isoDay;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return isoDay;
  return `${WEEKDAYS[date.getUTCDay()]}, ${d}/${m}/${y}`;
}
