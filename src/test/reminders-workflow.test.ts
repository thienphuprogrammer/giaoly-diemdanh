import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** `.github/workflows/reminders.yml`: bộ gọi định kỳ mặc định (Vercel Hobby không cho cron dưới một ngày). */
describe("workflow nhắc việc", () => {
  const yml = readFileSync("./.github/workflows/reminders.yml", "utf8");
  const run = yml.slice(yml.indexOf("run: |"));

  it("chạy mỗi 10 phút và có nút chạy tay", () => {
    expect(yml).toMatch(/schedule:\s*\n\s*- cron: "\*\/10 \* \* \* \*"/);
    expect(yml).toMatch(/^\s*workflow_dispatch:/m);
  });

  it("bí mật chỉ đến từ GitHub secrets qua env, không bao giờ in ra", () => {
    expect(yml).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(yml).toContain("APP_URL: ${{ secrets.APP_URL }}");
    expect(run).toContain("set +x");
    expect(yml).not.toMatch(/set -x/);
    expect(yml).not.toMatch(/echo[^\n]*\$\{?CRON_SECRET/);
  });

  it("bí mật không nằm trong argv của curl: header được đọc từ stdin (-H @-), do printf (builtin) ghi ra", () => {
    expect(run).toMatch(/printf 'Authorization: Bearer %s\\n' "\$CRON_SECRET" \|\s*\\?\s*\n?\s*curl[^\n]*/);
    expect(run).toContain("-H @-");
    expect(run).not.toMatch(/curl[^\n]*\$\{?CRON_SECRET/);
    expect(run).not.toMatch(/-H "Authorization/);
  });

  it("thiếu secret thì thất bại rõ ràng; APP_URL phải là https và bỏ '/' cuối", () => {
    expect(run).toMatch(/::error::[^\n]*\n\s*exit 1/);
    expect(run).not.toMatch(/exit 0/);
    expect(run).toMatch(/https:\/\/\*\)/);
    expect(run).toContain('"${APP_URL%/}/api/cron/nhac-viec"');
  });

  it("curl thất bại khi HTTP lỗi, hạn giờ dài hơn maxDuration 60 của route; quyền token tối thiểu", () => {
    expect(run).toContain("--fail");
    expect(run).toContain("--max-time 65");
    expect(yml).toMatch(/^permissions: \{\}$/m);
  });
});
