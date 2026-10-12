import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("vercel.json", () => {
  const raw = readFileSync("./vercel.json", "utf8");
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  it("chạy ở Singapore (sin1), cùng vùng với Postgres", () => expect(cfg.regions).toEqual(["sin1"]));
  it("framework Next.js", () => expect(cfg.framework).toBe("nextjs"));
  it("không chứa bí mật/biến môi trường; header để next.config.ts lo", () => {
    expect(cfg).not.toHaveProperty("env");
    expect(cfg).not.toHaveProperty("build");
    expect(cfg).not.toHaveProperty("headers");
    expect(raw).not.toMatch(/postgres:\/\/|AUTH_SECRET|CRON_SECRET/);
  });
  it("không bật `crons` mặc định: gói Hobby chỉ cho cron mỗi ngày, lịch 10 phút làm deploy thất bại (xem docs/deploy-vercel-ios.md)", () => {
    expect(cfg).not.toHaveProperty("crons");
  });
});
