/**
 * Thời điểm nhắc việc (spec §4), thuần và test được. Việt Nam không có giờ mùa hè nên dùng độ lệch +07 cố định và chỉ
 * các getter UTC: kết quả không phụ thuộc múi giờ của máy chủ (Vercel chạy UTC, máy dev có thể +07).
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Nhắc GLV 30 phút sau giờ bắt đầu nếu buổi hôm nay chưa có dấu điểm danh nào. */
export const REMINDER_DELAY_MINUTES = 30;
/** Hết 3 giờ sau giờ bắt đầu thì thôi nhắc (tác vụ chạy trễ/bị lỡ không nhắc lúc tối muộn). */
export const REMINDER_WINDOW_END_MINUTES = 180;

export interface VnClock {
  /** YYYY-MM-DD theo giờ Việt Nam. */
  date: string;
  /** 0 = Chủ nhật … 6 = Thứ bảy (như `classes.meets_on`). */
  weekday: number;
  /** Số phút từ 00:00 giờ Việt Nam. */
  minutes: number;
}

export function vnClock(now: Date): VnClock {
  const t = new Date(now.getTime() + VN_OFFSET_MS);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** "08:05:00" (cột `time`) hoặc "08:05" -> 485; null nếu không phải giờ hợp lệ. */
export function minutesOfDay(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Đến giờ nhắc lớp chưa: hôm nay (giờ Việt Nam) là thứ học của lớp và đã qua giờ bắt đầu từ 30 phút đến dưới 3 giờ.
 * Cửa sổ không tràn sang ngày hôm sau (lớp 22:00 chỉ được nhắc đến 23:59 cùng ngày).
 */
export function isClassReminderDue(schedule: { meetsOn: number | null; meetsAt: string | null }, clock: VnClock): boolean {
  const start = minutesOfDay(schedule.meetsAt);
  if (schedule.meetsOn === null || start === null || schedule.meetsOn !== clock.weekday) return false;
  const elapsed = clock.minutes - start;
  return elapsed >= REMINDER_DELAY_MINUTES && elapsed < REMINDER_WINDOW_END_MINUTES;
}
