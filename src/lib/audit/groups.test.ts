import { describe, expect, it } from "vitest";
import { AUDIT_LOG_GROUPS } from "@/db/queries/audit";
import { LOG_GROUPS, groupFromSlug, logHref } from "./groups";

const CLASS = "0b1c2d3e-1111-4222-8333-444455556666";

describe("log groups", () => {
  it("has a label and a unique slug for every query group, in the order of the filter bar", () => {
    expect(LOG_GROUPS.map((g) => g.group).sort()).toEqual([...AUDIT_LOG_GROUPS].sort());
    expect(new Set(LOG_GROUPS.map((g) => g.slug)).size).toBe(LOG_GROUPS.length);
    expect(LOG_GROUPS.map((g) => g.label)).toEqual(["Tất cả", "Điểm danh", "Đi lễ", "Thiếu nhi", "Sơ đồ", "Buổi học", "Quét thẻ"]);
  });

  it("maps slugs to groups and falls back to all", () => {
    expect(groupFromSlug("quet-the")).toBe("scan");
    expect(groupFromSlug("di-le")).toBe("mass");
    for (const bad of [undefined, "", "all", "attendance", "x"]) expect(groupFromSlug(bad)).toBe("all");
  });
});

describe("logHref", () => {
  it("builds a short shareable URL keeping only set filters, and round-trips the group", () => {
    expect(logHref(CLASS)).toBe(`/lop/${CLASS}/nhat-ky`);
    expect(logHref(CLASS, { group: "all" })).toBe(`/lop/${CLASS}/nhat-ky`);
    expect(logHref(CLASS, { from: "2026-10-01", to: "2026-10-12", group: "student" })).toBe(`/lop/${CLASS}/nhat-ky?tu=2026-10-01&den=2026-10-12&loai=thieu-nhi`);
    expect(logHref(CLASS, { group: "seating", cursor: "abc_-9" })).toBe(`/lop/${CLASS}/nhat-ky?loai=so-do&sau=abc_-9`);
  });
});
