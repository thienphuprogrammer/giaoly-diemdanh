import { describe, expect, it } from "vitest";
import { PUSH_BODY_MAX, PUSH_PAYLOAD_MAX_BYTES, PUSH_TITLE_MAX, buildPushPayload, safeNotificationUrl } from "./payload";

describe("safeNotificationUrl", () => {
  it.each([
    ["/", "/"],
    ["/lop/abc/diem-danh/2026-10-12", "/lop/abc/diem-danh/2026-10-12"],
    ["/can-chu-y?loai=di-le", "/can-chu-y?loai=di-le"],
  ])("keeps same-origin path %s", (input, out) => expect(safeNotificationUrl(input)).toBe(out));

  it.each([
    "//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)", "evil", "", " /x", "/x y", "/\nx",
    `/${"a".repeat(600)}`, 42, null, undefined,
  ])("falls back to / for %s", (input) => expect(safeNotificationUrl(input)).toBe("/"));
});

describe("buildPushPayload", () => {
  it("returns JSON {title, body, url}", () => {
    expect(JSON.parse(buildPushPayload({ title: "Nhắc điểm danh", body: "Lớp A chưa điểm danh", url: "/lop/x" })))
      .toEqual({ title: "Nhắc điểm danh", body: "Lớp A chưa điểm danh", url: "/lop/x" });
  });

  it("truncates title and body with an ellipsis, strips control characters, stays under 2KB", () => {
    const p = JSON.parse(buildPushPayload({ title: "Ấ".repeat(500), body: `a\u0000b${"\u0007".repeat(900)}${"ữ".repeat(900)}`, url: "/" })) as Record<string, string>;
    expect([...p.title].length).toBe(PUSH_TITLE_MAX);
    expect(p.title.endsWith("…")).toBe(true);
    expect([...p.body].length).toBe(PUSH_BODY_MAX);
    expect(p.body.startsWith("ab")).toBe(true);
    expect(/[\u0000-\u001f\u007f]/.test(p.body)).toBe(false);
    const worst = buildPushPayload({ title: "\"".repeat(1000), body: "\\".repeat(1000), url: `/${"%".repeat(500)}` });
    expect(new TextEncoder().encode(worst).length).toBeLessThanOrEqual(PUSH_PAYLOAD_MAX_BYTES);
  });

  it("replaces an unsafe url with /", () => {
    expect(JSON.parse(buildPushPayload({ title: "t", body: "b", url: "//evil.com" })).url).toBe("/");
  });
});
