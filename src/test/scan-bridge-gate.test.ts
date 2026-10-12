import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Cầu nối E2E (`window.__scanFeed`) phải nằm trong một `if` mà bản build production loại bỏ được lúc biên dịch
 * (NODE_ENV được thay bằng "production"). Kiểm tra thật là grep `.next/static` sau `pnpm build` (xem checklist).
 */
describe("E2E scan bridge gate", () => {
  it("is guarded by both the E2E flag and a non-production NODE_ENV in one condition", () => {
    const src = readFileSync("src/components/scan/useScanSession.ts", "utf8");
    expect(src).toContain('if (process.env.NEXT_PUBLIC_E2E_SCAN_BRIDGE === "1" && process.env.NODE_ENV !== "production") {');
    const at = src.indexOf("__scanFeed");
    expect(at).toBeGreaterThan(src.indexOf('process.env.NODE_ENV !== "production"'));
  });
});
