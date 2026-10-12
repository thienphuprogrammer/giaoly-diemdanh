import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";
import { APP_COLORS, IOS_SPLASH, appMetadata, appViewport } from "./pwa-meta";

const publicFile = (url: string) => path.join(process.cwd(), "public", url.replace(/^\//, ""));
/** Kích thước PNG đọc từ khối IHDR (byte 16–23). */
const pngSize = (url: string) => {
  const buf = readFileSync(publicFile(url));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

describe("viewport", () => {
  it("phủ toàn màn (viewport-fit=cover) để dùng safe-area, không khóa zoom toàn app", () => {
    expect(appViewport.viewportFit).toBe("cover");
    expect(appViewport.width).toBe("device-width");
    expect(appViewport.initialScale).toBe(1);
    expect(appViewport.userScalable).toBeUndefined();
    expect(appViewport.maximumScale).toBeUndefined();
  });

  it("màu theme trùng màu nền trang và manifest", () => {
    expect(appViewport.themeColor).toBe(APP_COLORS.theme);
    expect(manifest().theme_color).toBe(APP_COLORS.theme);
    expect(manifest().background_color).toBe(APP_COLORS.background);
  });
});

describe("metadata iOS", () => {
  it("chạy như app khi thêm vào Màn hình chính, thanh trạng thái mặc định (nền sáng, chữ tối)", () => {
    expect(appMetadata.appleWebApp).toMatchObject({ capable: true, title: "Điểm danh", statusBarStyle: "default" });
  });

  it("vẫn gửi thẻ apple-mobile-web-app-capable cho iOS cũ (Next chỉ in mobile-web-app-capable)", () => {
    expect(appMetadata.other).toEqual({ "apple-mobile-web-app-capable": "yes" });
  });

  it("apple-touch-icon 180x180 có thật trong public/", () => {
    const icons = appMetadata.icons as { apple: { url: string; sizes: string }[] };
    expect(icons.apple).toEqual([{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]);
    expect(pngSize("/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("mỗi ảnh khởi động có media query đúng kích thước và tệp đúng kích thước", () => {
    const startup = (appMetadata.appleWebApp as { startupImage: { url: string; media: string }[] }).startupImage;
    expect(startup).toHaveLength(IOS_SPLASH.length);
    for (const s of IOS_SPLASH) {
      const entry = startup.find((x) => x.url === s.url);
      expect(entry?.media).toBe(
        `(device-width: ${s.cssWidth}px) and (device-height: ${s.cssHeight}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`,
      );
      expect(pngSize(s.url)).toEqual({ width: s.cssWidth * s.ratio, height: s.cssHeight * s.ratio });
    }
  });

  it("không để iOS tự biến số trong trang thành link gọi điện (đã có nút Gọi riêng)", () => {
    expect(appMetadata.formatDetection).toEqual({ telephone: false });
  });
});

describe("manifest", () => {
  const m = manifest();

  it("standalone, có id/scope cố định và không khóa hướng xoay", () => {
    expect(m).toMatchObject({ id: "/", scope: "/", start_url: "/", display: "standalone", lang: "vi", short_name: "Điểm danh" });
    expect(m.orientation).toBeUndefined();
  });

  it("mọi icon khai báo đều có tệp đúng kích thước", () => {
    for (const icon of m.icons ?? []) {
      const [w, h] = (icon.sizes ?? "").split("x").map(Number);
      expect(existsSync(publicFile(icon.src))).toBe(true);
      expect(pngSize(icon.src)).toEqual({ width: w, height: h });
    }
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("lối tắt trỏ tới trang trong app", () => {
    expect(m.shortcuts?.map((s) => [s.name, s.url])).toEqual([["Lớp của tôi", "/"], ["Cần chú ý", "/can-chu-y"]]);
    expect(m.categories).toEqual(["education", "productivity"]);
  });
});
