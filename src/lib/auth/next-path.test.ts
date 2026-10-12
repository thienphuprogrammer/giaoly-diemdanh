import { describe, expect, it } from "vitest";
import { MAX_NEXT_LENGTH, loginHref, safeNextPath } from "./next-path";

describe("safeNextPath: accepts same-origin app paths", () => {
  it.each([
    ["/", "/"],
    ["/lop/abc", "/lop/abc"],
    ["/lop/abc/diem-danh/2026-10-12/quet", "/lop/abc/diem-danh/2026-10-12/quet"],
    ["/lop/abc/thong-ke?ky=hk1", "/lop/abc/thong-ke?ky=hk1"],
    ["/can-chu-y?q=Nguy%E1%BB%85n", "/can-chu-y?q=Nguy%E1%BB%85n"],
    ["/lop/abc#tab", "/lop/abc"], // phần # không cần cho máy chủ
    ["/lop/./abc", "/lop/abc"], // trả về dạng đã chuẩn hóa
    ["/loprac", "/loprac"],
    ["/apitest", "/apitest"],
    ["/lop/abc/thong-ke", "/lop/abc/thong-ke"],
    ["/lop/abc/thong-ke?export=1", "/lop/abc/thong-ke?export=1"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("safeNextPath: open-redirect and junk inputs fall back to /", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["number", 42],
    ["array", ["/lop"]],
    ["empty", ""],
    ["relative path", "lop/abc"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/lop"],
    ["triple slash", "///evil.example"],
    ["slash-backslash", "/\\evil.example"],
    ["backslash-slash", "\\/evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["backslash inside path", "/lop\\..\\..\\evil"],
    ["absolute http URL", "http://evil.example"],
    ["absolute https URL", "https://evil.example/lop"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,hi"],
    ["scheme with leading space", " https://evil.example"],
    ["leading space", " /lop"],
    ["tab after slash", "/\t/evil.example"],
    ["newline after slash", "/\n/evil.example"],
    ["CR LF injection", "/lop\r\nSet-Cookie: x=y"],
    ["NUL byte", "/lop\u0000"],
    ["DEL char", "/lop\u007f"],
    ["inner space", "/lop abc"],
    ["non-ASCII slash look-alike", "/／evil.example"],
    ["encoded second slash", "/%2fevil.example"],
    ["encoded second slash upper", "/%2Fevil.example"],
    ["encoded backslash", "/%5cevil.example"],
    ["encoded backslash in path", "/lop/%5C..%5Cevil"],
    ["double-encoded slash", "/%252fevil.example"],
    ["triple-encoded slash", "/%25252fevil.example"],
    ["encoded tab", "/%09/evil.example"],
    ["encoded CRLF", "/lop%0d%0aSet-Cookie:x"],
    ["encoded NUL", "/lop%00"],
    ["broken percent encoding", "/lop%E0%A4%A"],
    ["lone percent", "/lop%"],
    ["login page", "/login"],
    ["login page with query", "/login?next=/lop"],
    ["login with trailing slash", "/login/"],
    ["login via dot segment", "/lop/../login"],
    ["login percent-encoded", "/%6Cogin"],
    ["login upper case", "/LOGIN"],
    ["api root", "/api"],
    ["api route", "/api/diem-danh/quet"],
    ["api via dot segment", "/x/../api/diem-danh"],
    ["api upper case", "/API/diem-danh"],
    ["api percent-encoded", "/%61pi/diem-danh"],
    ["stats export download", "/lop/abc/thong-ke/export?termId=t1"],
    ["stats export via dot segment", "/lop/abc/x/../thong-ke/export"],
    ["stats export upper case", "/lop/abc/thong-ke/EXPORT"],
    ["stats export trailing slash", "/lop/abc/thong-ke/export/"],
    ["next internals", "/_next/static/chunks/app.js"],
    ["static file", "/favicon.ico"],
    ["manifest", "/manifest.webmanifest"],
    ["icon", "/icon-192.png"],
    ["too long", `/${"a".repeat(MAX_NEXT_LENGTH)}`],
  ])("%s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("accepts a path right at the length limit", () => {
    const path = `/${"a".repeat(MAX_NEXT_LENGTH - 1)}`;
    expect(safeNextPath(path)).toBe(path);
  });
});

describe("loginHref", () => {
  it("is plain /login for the home page or an unsafe path", () => {
    expect(loginHref("/")).toBe("/login");
    expect(loginHref("//evil.example")).toBe("/login");
    expect(loginHref(undefined)).toBe("/login");
  });

  it("carries a safe next path, encoded", () => {
    expect(loginHref("/lop/abc/diem-danh/2026-10-12/quet")).toBe("/login?next=%2Flop%2Fabc%2Fdiem-danh%2F2026-10-12%2Fquet");
    expect(loginHref("/lop/abc?ky=hk1&x=1")).toBe("/login?next=%2Flop%2Fabc%3Fky%3Dhk1%26x%3D1");
  });

  it("round-trips through URLSearchParams back to the same safe path", () => {
    const target = "/lop/abc/thong-ke?ky=hk1&x=a%20b";
    const href = loginHref(target);
    const next = new URL(href, "http://app.invalid").searchParams.get("next");
    expect(safeNextPath(next)).toBe(target);
  });
});
