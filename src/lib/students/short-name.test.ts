import { describe, expect, it } from "vitest";
import { shortName } from "./short-name";

describe("shortName", () => {
  it("uses the given name (last word)", () => expect(shortName("Nguyễn Văn An")).toBe("An"));
  it("handles one word and extra spaces", () => {
    expect(shortName("An")).toBe("An");
    expect(shortName("  Trần  Bình ")).toBe("Bình");
  });
  it("falls back to ? for empty input", () => expect(shortName("   ")).toBe("?"));
});
