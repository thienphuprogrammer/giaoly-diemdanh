import { describe, expect, it } from "vitest";
import { todayInVietnam } from "./dates";

describe("todayInVietnam", () => {
  it("uses the Vietnam calendar day, not UTC", () => {
    expect(todayInVietnam(new Date("2026-10-10T17:30:00Z"))).toBe("2026-10-11"); // 00:30 giờ VN
    expect(todayInVietnam(new Date("2026-10-10T16:59:00Z"))).toBe("2026-10-10"); // 23:59 giờ VN
  });
  it("handles midday and year boundaries", () => {
    expect(todayInVietnam(new Date("2026-10-11T05:00:00Z"))).toBe("2026-10-11");
    expect(todayInVietnam(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01-01");
  });
});
