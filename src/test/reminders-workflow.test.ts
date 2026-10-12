import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `.github/workflows/reminders.yml`: bộ gọi định kỳ mặc định (Vercel Hobby không cho cron dưới một ngày). */
describe("workflow nhắc việc", () => {
  const yml = readFileSync("./.github/workflows/reminders.yml", "utf8");

  it("chạy mỗi 10 phút và có nút chạy tay", () => {
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: "\*\/10 \* \* \* \*"/);
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("bí mật chỉ đến từ GitHub secrets, gửi qua header Bearer, không bao giờ in ra", () => {
    expect(yml).toContain("${{ secrets.CRON_SECRET }}");
    expect(yml).toContain("${{ secrets.APP_URL }}");
    expect(yml).toContain('-H "Authorization: Bearer ${CRON_SECRET}"');
    expect(yml).toContain("set +x");
    expect(yml).not.toMatch(/echo[^\n]*\$\{?CRON_SECRET/);
    expect(yml).not.toMatch(/set -x/);
  });

  it("curl thất bại khi HTTP lỗi và có hạn giờ; quyền token tối thiểu", () => {
    expect(yml).toContain("--fail");
    expect(yml).toContain("--max-time 30");
    expect(yml).toContain('"${APP_URL}/api/cron/nhac-viec"');
    expect(yml).toMatch(/^permissions: \{\}$/m);
  });
});
