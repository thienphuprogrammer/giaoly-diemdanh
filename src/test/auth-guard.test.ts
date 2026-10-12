import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkRouteSource, checkServerActionSource } from "./auth-guard-check";

/**
 * Proxy không chặn request không phải GET khi thiếu phiên (để server action tự chuyển hướng đúng giao thức), nên ranh giới
 * xác thực nằm ở từng server action và route handler. Test này khóa quy ước đó trên toàn bộ `src`.
 *
 * Danh sách cho phép phải nhỏ và có lý do:
 * - login: hành động đăng nhập, chưa có phiên; xác thực bằng email + mật khẩu (authenticate).
 * - logout nội tuyến ở /tai-khoan: trang đã gọi requireUser; hành động chỉ xóa cookie của chính request, không đụng dữ liệu.
 */
const ALLOW = ["src/app/login/actions.ts::login", "src/app/(app)/tai-khoan/page.tsx::logout"];

const SRC = path.resolve(__dirname, "..");
const ROOT = path.resolve(SRC, "..");

function sourceFiles(): { rel: string; src: string }[] {
  return (readdirSync(SRC, { recursive: true, encoding: "utf8" }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.split(path.sep).includes("test"))
    .map((f) => {
      const abs = path.join(SRC, f);
      return { rel: path.relative(ROOT, abs).split(path.sep).join("/"), src: readFileSync(abs, "utf8") };
    });
}

describe("ranh giới xác thực (cấu trúc)", () => {
  const files = sourceFiles();

  it("quét được các tệp mong đợi (tránh test rỗng)", () => {
    expect(files.some((f) => f.rel === "src/server/actions/attendance.ts")).toBe(true);
    expect(files.filter((f) => /\/route\.ts$/.test(f.rel)).length).toBeGreaterThanOrEqual(5);
    expect(files.filter((f) => /["']use server["']/.test(f.src)).length).toBeGreaterThanOrEqual(6);
  });

  it("mọi server action gọi requireUser( hoặc getCurrentUser(", () => {
    const violations = files.flatMap((f) => checkServerActionSource(f.rel, f.src, ALLOW));
    expect(violations).toEqual([]);
  });

  it("mọi route handler tham chiếu getCurrentUser hoặc handleScanApi", () => {
    const violations = files
      .filter((f) => /(^|\/)route\.ts$/.test(f.rel))
      .map((f) => checkRouteSource(f.rel, f.src))
      .filter((v) => v !== null);
    expect(violations).toEqual([]);
  });

  it("mục trong danh sách cho phép vẫn còn tồn tại (tránh danh sách thừa)", () => {
    for (const entry of ALLOW) {
      const [file, name] = entry.split("::");
      const f = files.find((x) => x.rel === file);
      expect(f, `${file} không còn`).toBeDefined();
      expect(f!.src, `${entry} không còn`).toMatch(new RegExp(`function\\s+${name}\\b`));
    }
  });
});
