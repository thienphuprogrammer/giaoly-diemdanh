import { describe, expect, it } from "vitest";
import { formatQrPayload, parseQrPayload } from "./payload";

const CODE = "0123456789abcdef0123456789abcdef";

describe("QR payload", () => {
  it("round-trips a token", () => {
    expect(parseQrPayload(formatQrPayload(CODE))).toBe(CODE);
    expect(formatQrPayload(CODE)).toBe(`dd1.${CODE}`);
  });
  it("trims surrounding whitespace", () => {
    expect(parseQrPayload(`  dd1.${CODE}\n`)).toBe(CODE);
  });
  it("rejects anything that is not our payload (never treats it as a URL)", () => {
    for (const bad of ["", "dd1.", `dd2.${CODE}`, `https://example.com/dd1.${CODE}`, `dd1.${CODE}x`, `dd1.${CODE.slice(1)}`, `dd1.${CODE.toUpperCase()}`, `dd1.${"g".repeat(32)}`, "javascript:alert(1)"]) {
      expect(parseQrPayload(bad)).toBeNull();
    }
  });
  it("refuses to format a malformed token", () => {
    expect(() => formatQrPayload("short")).toThrow();
  });
});
