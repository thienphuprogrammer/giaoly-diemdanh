import { expect, test } from "./fixtures";
import { CSP_HEADER, buildCsp } from "../src/lib/security-headers";

// Đọc/kiểm tra phần đầu trang và header một lần: không phụ thuộc cỡ màn hình.
test.skip(() => test.info().project.name !== "phone-375", "chỉ chạy ở phone-375");

test("header bảo mật: CSP (bản dev) và Permissions-Policy camera=(self)", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.ok()).toBe(true);
  const headers = res.headers();
  expect(headers[CSP_HEADER.toLowerCase()]).toBe(buildCsp({ isProd: false }));
  expect(headers["permissions-policy"]).toBe("camera=(self), microphone=(), geolocation=()");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("thẻ head cho iPhone: viewport-fit=cover, apple-touch-icon, ảnh khởi động, không khóa zoom", async ({ page }) => {
  await page.goto("/login");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("viewport-fit=cover");
  expect(viewport).not.toMatch(/user-scalable|maximum-scale/);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Điểm danh");
  await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "default");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  const startup = await page.locator('link[rel="apple-touch-startup-image"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(startup.length).toBeGreaterThanOrEqual(3);
  for (const href of [...startup, "/apple-touch-icon.png"]) {
    const r = await page.request.get(href!);
    expect(r.ok(), href!).toBe(true);
    expect(r.headers()["content-type"]).toBe("image/png");
  }
});

test("manifest: standalone, id/scope, icon tải được", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json() as { id: string; scope: string; display: string; icons: { src: string }[] };
  expect(m).toMatchObject({ id: "/", scope: "/", display: "standalone" });
  for (const icon of m.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
});
