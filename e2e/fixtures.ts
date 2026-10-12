import { test as base, expect, type Page } from "@playwright/test";

export { expect };
export type { Page };

/** Thông báo console của Chromium khi CSP chặn (hoặc Report-Only ghi nhận) một tài nguyên/script. */
const CSP_CONSOLE = /Content Security Policy/i;

/**
 * Mọi test dùng `test` này đều bị kiểm tra: không trang nào (của context mặc định) có vi phạm CSP trong console.
 * Bắt cả chế độ Report-Only ("[Report Only] Refused to …") lẫn chặn thật.
 */
export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [async ({ context }, use) => {
    const violations: string[] = [];
    const watch = (page: Page) => page.on("console", (msg) => {
      if (CSP_CONSOLE.test(msg.text())) violations.push(`${page.url()} :: ${msg.text()}`);
    });
    context.pages().forEach(watch);
    context.on("page", watch);
    await use();
    expect(violations, "vi phạm Content Security Policy trong console").toEqual([]);
  }, { auto: true }],
});
