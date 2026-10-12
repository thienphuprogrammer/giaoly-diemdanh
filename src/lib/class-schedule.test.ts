import { describe, expect, it } from "vitest";
import { WEEKDAY_LABELS, parseScheduleInput, scheduleLabel, toHhMm } from "./class-schedule";

describe("WEEKDAY_LABELS / scheduleLabel", () => {
  it("labels 0 as Chủ nhật and 6 as Thứ bảy", () => {
    expect(WEEKDAY_LABELS).toEqual(["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]);
    expect(scheduleLabel({ meetsOn: 0, meetsAt: "08:00:00" })).toBe("Chủ nhật 08:00");
    expect(scheduleLabel({ meetsOn: 6, meetsAt: "17:30" })).toBe("Thứ bảy 17:30");
  });
  it("is null when unset or half set", () => {
    expect(scheduleLabel({ meetsOn: null, meetsAt: null })).toBeNull();
    expect(scheduleLabel({ meetsOn: 1, meetsAt: null })).toBeNull();
    expect(scheduleLabel({ meetsOn: 9, meetsAt: "08:00" })).toBeNull();
  });
  it("toHhMm trims seconds and rejects junk", () => {
    expect(toHhMm("08:05:00")).toBe("08:05");
    expect(toHhMm(null)).toBeNull();
    expect(toHhMm("x")).toBeNull();
  });
});

describe("parseScheduleInput", () => {
  it.each([
    [{ meetsOn: 0, meetsAt: "00:00" }, { meetsOn: 0, meetsAt: "00:00" }],
    [{ meetsOn: 6, meetsAt: "23:59" }, { meetsOn: 6, meetsAt: "23:59" }],
    [{ meetsOn: "3", meetsAt: "18:30" }, { meetsOn: 3, meetsAt: "18:30" }],
    [{ meetsOn: null, meetsAt: null }, { meetsOn: null, meetsAt: null }],
    [{ meetsOn: "", meetsAt: "" }, { meetsOn: null, meetsAt: null }],
    [{}, { meetsOn: null, meetsAt: null }],
  ])("accepts %j", (input, out) => expect(parseScheduleInput(input)).toEqual({ ok: true, value: out }));

  it.each([
    [{ meetsOn: -1, meetsAt: "08:00" }],
    [{ meetsOn: 7, meetsAt: "08:00" }],
    [{ meetsOn: 1.5, meetsAt: "08:00" }],
    [{ meetsOn: "abc", meetsAt: "08:00" }],
    [{ meetsOn: "1e0", meetsAt: "08:00" }],
    [{ meetsOn: 1, meetsAt: "24:00" }],
    [{ meetsOn: 1, meetsAt: "12:60" }],
    [{ meetsOn: 1, meetsAt: "7:00" }],
    [{ meetsOn: 1, meetsAt: "08:00:00" }],
    [{ meetsOn: 1, meetsAt: "8h" }],
    [{ meetsOn: 1, meetsAt: null }],
    [{ meetsOn: null, meetsAt: "08:00" }],
    [{ meetsOn: "", meetsAt: "08:00" }],
    [{ meetsOn: true, meetsAt: "08:00" }],
  ])("refuses %j", (input) => {
    const r = parseScheduleInput(input);
    expect(r.ok).toBe(false);
  });
});
