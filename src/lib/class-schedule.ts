/**
 * Lịch học của lớp (spec §4): thứ trong tuần (0 = Chủ nhật … 6 = Thứ bảy, như `Date.getDay()`) và giờ bắt đầu "HH:MM"
 * (24 giờ, giờ Việt Nam). Cả hai cùng có hoặc cùng trống (trống = không nhắc việc). Thuần, test được.
 */
export const WEEKDAY_LABELS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"] as const;

export interface ClassSchedule { meetsOn: number | null; meetsAt: string | null }

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "08:05:00" (cột `time`) hoặc "08:05" -> "08:05"; null nếu không phải giờ hợp lệ. */
export function toHhMm(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const hhmm = value.slice(0, 5);
  return HH_MM.test(hhmm) && (value.length === 5 || /^:\d\d(\.\d+)?$/.test(value.slice(5))) ? hhmm : null;
}

const isWeekday = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;

/** "Chủ nhật 08:00"; null khi chưa đặt lịch. */
export function scheduleLabel(s: ClassSchedule): string | null {
  const time = toHhMm(s.meetsAt);
  return isWeekday(s.meetsOn) && time ? `${WEEKDAY_LABELS[s.meetsOn]} ${time}` : null;
}

export const SCHEDULE_ERRORS = {
  day: "Chọn thứ trong tuần (Chủ nhật đến Thứ bảy)",
  time: "Giờ học phải có dạng GG:PP (24 giờ), ví dụ 08:00",
  both: "Cần chọn cả thứ và giờ học, hoặc để trống cả hai",
} as const;

const blank = (v: unknown) => v === undefined || v === null || v === "";

function parseDay(v: unknown): number | null | "bad" {
  if (blank(v)) return null;
  if (typeof v === "number") return isWeekday(v) ? v : "bad";
  if (typeof v === "string" && /^\d$/.test(v)) return isWeekday(Number(v)) ? Number(v) : "bad";
  return "bad";
}

export function parseScheduleInput(input: { meetsOn?: unknown; meetsAt?: unknown }): { ok: true; value: ClassSchedule } | { ok: false; error: string } {
  const day = parseDay(input.meetsOn);
  if (day === "bad") return { ok: false, error: SCHEDULE_ERRORS.day };
  const rawTime = input.meetsAt;
  if (!blank(rawTime) && (typeof rawTime !== "string" || !HH_MM.test(rawTime))) return { ok: false, error: SCHEDULE_ERRORS.time };
  const time = blank(rawTime) ? null : (rawTime as string);
  if ((day === null) !== (time === null)) return { ok: false, error: SCHEDULE_ERRORS.both };
  return { ok: true, value: { meetsOn: day, meetsAt: time } };
}
