const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngày YYYY-MM-DD → mốc 00:00 UTC; ném lỗi khi sai định dạng hoặc ngày không có thật (vd 30/02). */
function utcMidnight(day: string): number {
  const m = ISO_DATE.exec(day);
  if (!m) throw new Error(`Ngày không hợp lệ: ${day}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`Ngày không hợp lệ: ${day}`);
  return ms;
}

/**
 * Chúa nhật gần nhất trên hoặc trước ngày học (học Chúa nhật → chính ngày đó; học thứ Bảy → Chúa nhật liền trước).
 * Tính hoàn toàn theo UTC trên chuỗi ngày nên không phụ thuộc múi giờ của máy.
 */
export function massSundayFor(heldOn: string): string {
  const ms = utcMidnight(heldOn);
  const weekday = new Date(ms).getUTCDay(); // 0 = Chúa nhật
  return new Date(ms - weekday * DAY_MS).toISOString().slice(0, 10);
}
