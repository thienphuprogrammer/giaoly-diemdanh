import { describe, expect, it } from "vitest";
import { GENERIC_FAILURE, errorSummary } from "./error-summary";

describe("errorSummary (scripts: never print raw driver messages)", () => {
  it("prints only a machine error code", () => {
    const e = Object.assign(new Error("connect failed to host db.internal:5432 user secret"), { code: "ECONNREFUSED" });
    expect(errorSummary(e)).toBe("Lỗi: ECONNREFUSED");
  });
  it("prints a generic message when there is no code", () => {
    expect(errorSummary(new Error("password authentication failed for user x"))).toBe(GENERIC_FAILURE);
    expect(errorSummary("boom")).toBe(GENERIC_FAILURE);
    expect(errorSummary(null)).toBe(GENERIC_FAILURE);
  });
  it("ignores code values that are not plain identifiers", () => {
    expect(errorSummary(Object.assign(new Error("x"), { code: "a b://c" }))).toBe(GENERIC_FAILURE);
  });
  it("keeps the script's own known messages", () => {
    expect(errorSummary(new Error("Chưa có dữ liệu seed"), ["Chưa có dữ liệu seed"])).toBe("Chưa có dữ liệu seed");
  });
});
