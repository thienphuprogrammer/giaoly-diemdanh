/**
 * Năm học mới (spec §3): giá trị mặc định = hai học kỳ của năm trước dời sau đúng một năm, và kiểm tra khoảng ngày.
 * Hàm thuần trên chuỗi YYYY-MM-DD (ngày lịch Việt Nam, không có giờ) nên không phụ thuộc múi giờ của máy.
 */

export interface TermRange { startsOn: string; endsOn: string }
export interface TermInput extends TermRange { name: string }
export interface SchoolYearDraft { name: string; term1: TermInput; term2: TermInput }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
/** Một năm học (từ đầu học kỳ 1 đến hết học kỳ 2) dài tối đa chừng này ngày. */
export const MAX_YEAR_DAYS = 400;

function parts(day: string): [number, number, number] {
  const m = ISO_DATE.exec(day);
  if (!m) throw new Error(`Ngày không hợp lệ: ${day}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(Date.UTC(y, mo - 1, d));
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) throw new Error(`Ngày không hợp lệ: ${day}`);
  return [y, mo, d];
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

/** Cộng `n` năm; 29/02 sang năm không nhuận thành 28/02. */
export function addYears(day: string, n: number): string {
  const [y, mo, d] = parts(day);
  const year = y + n;
  return `${pad(year, 4)}-${pad(mo)}-${pad(Math.min(d, daysInMonth(year, mo)))}`;
}

/** "2026-2027" → "2027-2028" (giữ chữ và dấu nối xung quanh); tên không có cặp năm → chuỗi rỗng. */
export function nextYearName(name: string): string {
  const m = /(\d{4})(\s*[-–]\s*)(\d{4})/.exec(name);
  if (!m) return "";
  const [whole, a, sep, b] = m;
  return name.replace(whole, `${Number(a) + 1}${sep}${Number(b) + 1}`);
}

const shift = (t: TermInput): TermInput => ({ name: t.name, startsOn: addYears(t.startsOn, 1), endsOn: addYears(t.endsOn, 1) });

/** Năm học chưa có gì để dựa vào: 01/09 → 15/01 và 16/01 → 31/05, bắt đầu ở tháng 9 kế tiếp (tính từ hôm nay). */
function freshYear(today: string): SchoolYearDraft {
  const [y, mo] = parts(today);
  const start = mo >= 9 ? y + 1 : y;
  return {
    name: `${start}-${start + 1}`,
    term1: { name: "Học kỳ 1", startsOn: `${start}-09-01`, endsOn: `${start + 1}-01-15` },
    term2: { name: "Học kỳ 2", startsOn: `${start + 1}-01-16`, endsOn: `${start + 1}-05-31` },
  };
}

/**
 * Giá trị mặc định cho form "Tạo năm học": hai học kỳ đầu tiên (theo ngày bắt đầu) của năm học trước, dời một năm.
 * Không có năm trước hoặc năm trước thiếu học kỳ → đề xuất tháng 9 tới tháng 5.
 */
export function defaultSchoolYear(previous: { name: string; terms: readonly TermInput[] } | null, today: string): SchoolYearDraft {
  if (!previous || previous.terms.length < 2) return freshYear(today);
  const [t1, t2] = [...previous.terms].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const term1 = shift(t1);
  return { name: nextYearName(previous.name) || freshYear(today).name, term1, term2: shift(t2) };
}

const dayNumber = (day: string) => { const [y, mo, d] = parts(day); return Date.UTC(y, mo - 1, d) / DAY_MS; };

/** Hai khoảng ngày (tính cả hai đầu) có chung ít nhất một ngày. */
export function termsOverlap(a: TermRange, b: TermRange): boolean {
  return a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
}

/** null khi hợp lệ; nếu không, câu báo lỗi tiếng Việt. Ngày phải có thật (ném lỗi ở `parts` được bắt ở đây). */
export function validateTermRanges(term1: TermRange, term2: TermRange): string | null {
  try {
    [term1.startsOn, term1.endsOn, term2.startsOn, term2.endsOn].forEach(parts);
  } catch {
    return "Ngày không hợp lệ";
  }
  if (term1.endsOn < term1.startsOn) return "Học kỳ 1: ngày kết thúc phải sau ngày bắt đầu";
  if (term2.endsOn < term2.startsOn) return "Học kỳ 2: ngày kết thúc phải sau ngày bắt đầu";
  if (term2.startsOn <= term1.endsOn) return "Học kỳ 2 phải bắt đầu sau khi học kỳ 1 kết thúc";
  if (dayNumber(term2.endsOn) - dayNumber(term1.startsOn) > MAX_YEAR_DAYS) return `Năm học quá dài (tối đa ${MAX_YEAR_DAYS} ngày)`;
  return null;
}

/** Cộng `n` ngày (âm = lùi) vào ngày YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Học kỳ 1 của năm học mới phải bắt đầu trong [hôm nay − 400 ngày, hôm nay + 550 ngày]. */
export const START_WINDOW = { before: 400, after: 550 } as const;
export function startWindow(today: string): { min: string; max: string } {
  return { min: addDays(today, -START_WINDOW.before), max: addDays(today, START_WINDOW.after) };
}

/**
 * Giá trị mặc định của form "Tạo năm học" luôn nằm trong `startWindow(today)`: năm trước dời một năm nếu hợp lệ, nếu không
 * (năm gần nhất quá cũ, hoặc năm sau đã được tạo sớm nên dời nữa thì quá xa) thì tháng 9 kế tiếp tính từ hôm nay.
 */
export function suggestSchoolYear(previous: { name: string; terms: readonly TermInput[] } | null, today: string): SchoolYearDraft {
  const shifted = defaultSchoolYear(previous, today);
  const { min, max } = startWindow(today);
  return shifted.term1.startsOn >= min && shifted.term1.startsOn <= max ? shifted : defaultSchoolYear(null, today);
}
