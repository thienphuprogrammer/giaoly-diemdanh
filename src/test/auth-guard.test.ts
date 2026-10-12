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
 * - route /api/health: kiểm tra sống công khai có chủ đích (giám sát, kiểm tra sau deploy); chỉ trả {ok, db, version}, không đọc phiên hay dữ liệu.
 * - route /api/cron/nhac-viec: tác vụ định kỳ, không có phiên người dùng; xác thực bằng `Authorization: Bearer <CRON_SECRET>`
 *   (so sánh hằng thời gian, thiếu/ngắn bí mật thì 503). Chỉ miễn khi CHÍNH tệp đó gọi `handleCronRequest(` (dạng `tệp::hàm`).
 */
const CRON_ROUTE = "src/app/api/cron/nhac-viec/route.ts";
const ALLOW_ROUTES = ["src/app/api/health/route.ts", `${CRON_ROUTE}::handleCronRequest`];
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
      .map((f) => checkRouteSource(f.rel, f.src, ALLOW_ROUTES))
      .filter((v) => v !== null);
    expect(violations).toEqual([]);
  });

  it("route được miễn vẫn còn tồn tại (tránh danh sách thừa)", () => {
    for (const entry of ALLOW_ROUTES) {
      const rel = entry.split("::")[0];
      expect(files.some((f) => f.rel === rel), `${rel} không còn`).toBe(true);
    }
  });

  it("route cron chỉ xác thực bằng CRON_SECRET: không đọc cookie/phiên, có GET (Vercel Cron) và POST", () => {
    const f = files.find((x) => x.rel === CRON_ROUTE);
    expect(f).toBeDefined();
    expect(f!.src).not.toMatch(/\bcookies\s*\(|getCurrentUser|requireUser/);
    expect(f!.src).toMatch(/export const GET\b/);
    expect(f!.src).toMatch(/export const POST\b/);
    expect(checkRouteSource(CRON_ROUTE, f!.src, ALLOW_ROUTES)).toBeNull();
  });

  it("miễn trừ của cron không áp cho route khác cùng thư mục", () => {
    const src = `export const GET = (r: Request) => handleCronRequest(r, deps);`;
    expect(checkRouteSource("src/app/api/cron/khac/route.ts", src, ALLOW_ROUTES)).not.toBeNull();
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
