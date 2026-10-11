const WEEKDAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"] as const;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tách một ngày ISO hợp lệ; null nếu sai định dạng hoặc không có thật (vd. 30/02). */
function parse(isoDay: string): { y: string; m: string; d: string; weekday: number } | null {
  const match = ISO_DAY.exec(isoDay);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return { y, m, d, weekday: date.getUTCDay() };
}

/** "2026-10-11" -> "Chủ nhật, 11/10/2026". Chỉ dùng để hiển thị; chuỗi không hợp lệ được trả lại nguyên vẹn. */
export function dateLabel(isoDay: string): string {
  const p = parse(isoDay);
  return p ? `${WEEKDAYS[p.weekday]}, ${p.d}/${p.m}/${p.y}` : isoDay;
}

/** "2014-07-16" -> "16/07/2014". Chuỗi không hợp lệ được trả lại nguyên vẹn. */
export function shortDate(isoDay: string): string {
  const p = parse(isoDay);
  return p ? `${p.d}/${p.m}/${p.y}` : isoDay;
}
