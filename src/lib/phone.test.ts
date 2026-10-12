import { describe, expect, it } from "vitest";
import { normalizePhone, phoneLinks, toInternationalDigits } from "./phone";

describe("normalizePhone", () => {
  const valid: [string, string][] = [
    ["0901234567", "0901234567"],
    ["0901 234 567", "0901234567"],
    ["0901.234.567", "0901234567"],
    ["0901-234-567", "0901234567"],
    ["(090) 123 4567", "0901234567"],
    ["+84 901 234 567", "0901234567"],
    ["+84901234567", "0901234567"],
    ["84901234567", "0901234567"],
    ["0084901234567", "0901234567"],
    ["+84 (0) 901 234 567", "0901234567"],
    ["  0901234567  ", "0901234567"],
    ["02438123456", "02438123456"],
    ["+842438123456", "02438123456"],
  ];
  it.each(valid)("accepts %j as %j", (input, expected) => {
    expect(normalizePhone(input)).toEqual({ ok: true, value: expected });
  });

  const invalid = ["", "   ", "abc", "090123", "090123456789012", "1901234567", "+1 415 555 0100", "0901 234 56a", "+84 01", "9012345678"];
  it.each(invalid)("rejects %j", (input) => {
    expect(normalizePhone(input).ok).toBe(false);
  });
});

describe("toInternationalDigits", () => {
  it("returns digits with country code and no plus", () => {
    expect(toInternationalDigits("0901234567")).toBe("84901234567");
    expect(toInternationalDigits("+84 901 234 567")).toBe("84901234567");
  });
  it("returns null for an invalid number", () => {
    expect(toInternationalDigits("abc")).toBeNull();
  });
});

describe("phoneLinks", () => {
  it("builds tel, sms and zalo links", () => {
    expect(phoneLinks("0901 234 567")).toEqual({
      display: "0901234567",
      tel: "tel:0901234567",
      sms: "sms:0901234567",
      zalo: "https://zalo.me/84901234567",
    });
  });
  it("returns null when empty or invalid", () => {
    expect(phoneLinks(null)).toBeNull();
    expect(phoneLinks("")).toBeNull();
    expect(phoneLinks("xyz")).toBeNull();
  });
});
