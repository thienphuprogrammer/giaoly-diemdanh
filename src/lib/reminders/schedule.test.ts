import { describe, expect, it } from "vitest";
import { REMINDER_DELAY_MINUTES, REMINDER_WINDOW_END_MINUTES, isClassReminderDue, minutesOfDay, vnClock } from "./schedule";

/** Giờ Việt Nam (+07) -> Date UTC. */
const vn = (iso: string) => new Date(`${iso}+07:00`);

describe("vnClock", () => {
  it("dùng độ lệch +07 cố định: ngày, thứ và phút trong ngày theo giờ Việt Nam", () => {
    // 2026-10-11 là Chủ nhật.
    expect(vnClock(vn("2026-10-11T08:30:00"))).toEqual({ date: "2026-10-11", weekday: 0, minutes: 510 });
    expect(vnClock(vn("2026-10-17T23:59:00"))).toEqual({ date: "2026-10-17", weekday: 6, minutes: 1439 });
  });

  it("qua nửa đêm UTC/VN đúng ngày Việt Nam", () => {
    // 17:30 UTC ngày 10 = 00:30 VN ngày 11 (Chủ nhật).
    expect(vnClock(new Date("2026-10-10T17:30:00Z"))).toEqual({ date: "2026-10-11", weekday: 0, minutes: 30 });
    // 16:59 UTC ngày 10 = 23:59 VN ngày 10 (Thứ bảy).
    expect(vnClock(new Date("2026-10-10T16:59:00Z"))).toEqual({ date: "2026-10-10", weekday: 6, minutes: 1439 });
  });

  it("không phụ thuộc múi giờ của máy chủ (chỉ dùng getter UTC)", () => {
    const d = vn("2026-01-01T00:00:00");
    expect(vnClock(d).date).toBe("2026-01-01");
    expect(vnClock(d).weekday).toBe(4);
  });
});

describe("minutesOfDay", () => {
  it.each([
    ["08:00:00", 480], ["08:00", 480], ["00:00:00", 0], ["23:59:59", 1439], ["17:30:00.000", 1050],
  ])("%s -> %d", (v, m) => expect(minutesOfDay(v)).toBe(m));
  it.each([null, undefined, "", "24:00", "8:00", "ab:cd", "12:60"])("%s -> null", (v) => expect(minutesOfDay(v as string | null)).toBeNull());
});

describe("isClassReminderDue", () => {
  const sunday8 = { meetsOn: 0, meetsAt: "08:00:00" };
  const at = (hhmm: string) => vnClock(vn(`2026-10-11T${hhmm}:00`));

  it("hằng số: 30 phút sau giờ bắt đầu, hết cửa sổ sau 3 giờ", () => {
    expect(REMINDER_DELAY_MINUTES).toBe(30);
    expect(REMINDER_WINDOW_END_MINUTES).toBe(180);
  });

  it.each([
    ["07:59", false], ["08:00", false], ["08:29", false], // trước cửa sổ
    ["08:30", true], ["09:00", true], ["10:59", true], // trong cửa sổ
    ["11:00", false], ["15:00", false], // từ +3 giờ trở đi
  ])("Chủ nhật %s -> %s", (hhmm, due) => expect(isClassReminderDue(sunday8, at(hhmm))).toBe(due));

  it("ngày khác thứ học thì không nhắc", () => {
    expect(isClassReminderDue(sunday8, vnClock(vn("2026-10-12T09:00:00")))).toBe(false); // Thứ hai
    expect(isClassReminderDue({ meetsOn: 1, meetsAt: "08:00:00" }, vnClock(vn("2026-10-12T09:00:00")))).toBe(true);
  });

  it("lớp chưa đặt lịch hoặc lịch hỏng thì không nhắc", () => {
    const now = at("09:00");
    expect(isClassReminderDue({ meetsOn: null, meetsAt: null }, now)).toBe(false);
    expect(isClassReminderDue({ meetsOn: 0, meetsAt: null }, now)).toBe(false);
    expect(isClassReminderDue({ meetsOn: null, meetsAt: "08:00:00" }, now)).toBe(false);
    expect(isClassReminderDue({ meetsOn: 0, meetsAt: "rubbish" }, now)).toBe(false);
  });

  it("lớp học muộn: cửa sổ không tràn sang ngày hôm sau", () => {
    const late = { meetsOn: 0, meetsAt: "22:00:00" };
    expect(isClassReminderDue(late, at("22:30"))).toBe(true);
    expect(isClassReminderDue(late, at("23:59"))).toBe(true);
    // 00:30 Thứ hai: đã sang ngày khác (thứ khác) => không nhắc.
    expect(isClassReminderDue(late, vnClock(vn("2026-10-12T00:30:00")))).toBe(false);
  });
});
