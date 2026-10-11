import { describe, expect, it } from "vitest";
import { dateLabel, shortDate } from "./date-label";

describe("dateLabel", () => {
  it("formats an ISO day as a Vietnamese weekday + dd/mm/yyyy", () => {
    expect(dateLabel("2026-10-11")).toBe("Chủ nhật, 11/10/2026");
    expect(dateLabel("2026-10-12")).toBe("Thứ hai, 12/10/2026");
    expect(dateLabel("2026-10-17")).toBe("Thứ bảy, 17/10/2026");
  });
  it("pads day and month and does not depend on the host time zone", () => {
    expect(dateLabel("2027-01-01")).toBe("Thứ sáu, 01/01/2027");
    expect(dateLabel("2024-02-29")).toBe("Thứ năm, 29/02/2024");
  });
  it("returns the input unchanged when it is not a valid ISO day", () => {
    expect(dateLabel("hôm nay")).toBe("hôm nay");
    expect(dateLabel("2026-02-30")).toBe("2026-02-30");
  });
});

describe("shortDate", () => {
  it("formats an ISO day as dd/mm/yyyy", () => {
    expect(shortDate("2014-07-16")).toBe("16/07/2014");
  });
  it("returns the input unchanged when it is not a valid ISO day", () => {
    expect(shortDate("16/07/2014")).toBe("16/07/2014");
    expect(shortDate("2014-13-01")).toBe("2014-13-01");
  });
});
