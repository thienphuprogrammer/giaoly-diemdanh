import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kiểm tra cấu trúc cho iPhone (không giả lập được safe-area/zoom trong Playwright Chromium):
 * mọi chỗ chừa home indicator/tai thỏ đi qua tiện ích `*-safe` của globals.css, và ô nhập không nhỏ hơn 16px.
 */
const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const css = read("src/app/globals.css");

function tsxFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) return tsxFiles(rel);
    return rel.endsWith(".tsx") ? [rel] : [];
  });
}

describe("safe-area", () => {
  it("globals.css định nghĩa biến inset có giá trị dự phòng 0", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(css).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px)`);
    }
  });

  it("globals.css có các tiện ích safe-area", () => {
    for (const u of ["pt-safe-*", "pb-safe-*", "bottom-safe-*", "top-safe"]) {
      expect(css).toContain(`@utility ${u} {`);
    }
  });

  it("không component nào gọi env(safe-area-inset-*) trực tiếp", () => {
    const offenders = tsxFiles("src").filter((f) => read(f).includes("safe-area-inset"));
    expect(offenders).toEqual([]);
  });

  it.each([
    ["src/components/nav/BottomNav.tsx", "pb-safe"],
    ["src/app/(app)/layout.tsx", "pb-safe-"],
    ["src/components/ui/Sheet.tsx", "pb-safe-"],
    ["src/components/attendance/SaveStatus.tsx", "bottom-safe-"],
    ["src/components/scan/ScanScreen.tsx", "pt-safe-"],
    ["src/components/scan/ScanScreen.tsx", "pb-safe-"],
    ["src/app/(app)/lop/[classId]/layout.tsx", "top-safe"],
  ])("%s dùng %s", (file, cls) => {
    expect(read(file)).toContain(cls);
  });
});

describe("màn quét trên iOS", () => {
  it("chặn zoom/kéo nảy chỉ trong màn quét, không khóa zoom toàn app", () => {
    expect(css).toMatch(/\.scan-screen\s*{[^}]*touch-action: manipulation;[^}]*touch-action: pan-x pan-y;/);
    expect(css).toMatch(/:root:has\(\.scan-screen\)[^{]*{[^}]*overscroll-behavior: none;/);
    expect(read("src/components/scan/ScanScreen.tsx")).toContain("scan-screen");
  });

  it("khung camera không cho chọn chữ/menu nhấn giữ; video có đủ thuộc tính iOS", () => {
    expect(css).toMatch(/\.scan-viewfinder\s*{[^}]*-webkit-touch-callout: none;[^}]*user-select: none;/);
    const cam = read("src/components/scan/QrCamera.tsx");
    expect(cam).toContain("scan-viewfinder");
    const video = cam.match(/<video[^>]*>/)?.[0] ?? "";
    for (const attr of ["muted", "playsInline", "autoPlay"]) expect(video).toContain(attr);
  });
});

describe("ô nhập ≥ 16px (iOS tự phóng to khi focus ô nhỏ hơn)", () => {
  it(".input dùng 1rem", () => {
    expect(css).toMatch(/\.input\s*{[^}]*font-size: 1rem;/);
  });

  it("không ô input/select/textarea nào đặt cỡ chữ nhỏ hơn", () => {
    const offenders = tsxFiles("src").flatMap((f) =>
      // `=>` của hàm mũi tên trong props không phải dấu đóng thẻ.
      [...read(f).matchAll(/<(input|select|textarea)\b(?:=>|[^>])*?className="([^"]*)"/g)]
        .filter((m) => /(^|\s)([a-z-]+:)?text-(xs|sm|\[)/.test(m[2]))
        .map((m) => `${f}: <${m[1]} ${m[2].slice(0, 60)}`));
    expect(offenders).toEqual([]);
  });
});
