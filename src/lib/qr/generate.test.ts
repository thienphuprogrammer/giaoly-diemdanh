// @vitest-environment node
import { describe, expect, it } from "vitest";
import { qrSvg } from "./generate";

describe("qrSvg", () => {
  it("returns an svg document without scripts", async () => {
    const svg = await qrSvg("dd1.0123456789abcdef0123456789abcdef");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("<script");
  });

  it("gives different SVGs for different payloads", async () => {
    const a = await qrSvg("dd1.0123456789abcdef0123456789abcdef");
    const b = await qrSvg("dd1.fedcba9876543210fedcba9876543210");
    expect(a).not.toBe(b);
  });
});
