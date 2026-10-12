import { afterEach, describe, expect, it, vi } from "vitest";
import { isSunday, massSundayFor, massWeekDays } from "./mass-week";

describe("massSundayFor", () => {
  it.each([
    ["2026-10-11", "2026-10-11", "Sunday stays the same day"],
    ["2026-10-10", "2026-10-04", "Saturday goes back to the previous Sunday"],
    ["2026-10-12", "2026-10-11", "Monday goes back one day"],
    ["2026-10-14", "2026-10-11", "Wednesday"],
    ["2026-10-01", "2026-09-27", "month boundary"],
    ["2027-01-02", "2026-12-27", "year boundary (Saturday)"],
    ["2027-01-03", "2027-01-03", "first Sunday of the year"],
    ["2028-03-01", "2028-02-27", "leap-year February"],
    ["2026-03-01", "2026-03-01", "Sunday on the first of the month"],
    ["2026-03-07", "2026-03-01", "Saturday right after"],
  ])("%s -> %s (%s)", (heldOn, sunday) => {
    expect(massSundayFor(heldOn)).toBe(sunday);
  });

  describe("does not depend on the process time zone", () => {
    const original = process.env.TZ;
    afterEach(() => { process.env.TZ = original; });
    it.each(["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Ho_Chi_Minh", "America/Los_Angeles"])("TZ=%s", (tz) => {
      process.env.TZ = tz;
      vi.setSystemTime(new Date("2026-10-10T23:30:00Z"));
      expect(massSundayFor("2026-10-10")).toBe("2026-10-04");
      expect(massSundayFor("2026-10-11")).toBe("2026-10-11");
      vi.useRealTimers();
    });
  });

  it.each(["", "2026-1-1", "11/10/2026", "2026-02-30", "2026-13-01", "abcd-ef-gh"])("rejects %j", (bad) => {
    expect(() => massSundayFor(bad)).toThrow();
  });
});

describe("isSunday", () => {
  it.each([["2026-10-11", true], ["2026-10-10", false], ["2026-10-12", false], ["bad", false], ["2026-02-30", false]])("%s -> %s", (day, expected) => {
    expect(isSunday(day)).toBe(expected);
  });
});

describe("massWeekDays (class days whose Mass is that week's Sunday)", () => {
  it("lists Sunday..Saturday of the week containing the day", () => {
    const week = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    expect(massWeekDays("2026-08-30")).toEqual(week);
    expect(massWeekDays("2026-09-02")).toEqual(week);
    expect(massWeekDays("2026-09-05")).toEqual(week);
  });
  it("crosses year boundaries", () => {
    expect(massWeekDays("2026-12-27")).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });
  it("rejects invalid days", () => {
    expect(() => massWeekDays("2026-02-30")).toThrow();
  });
});
