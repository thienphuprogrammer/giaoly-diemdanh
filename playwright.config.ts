import { defineConfig } from "@playwright/test";

const url = process.env.E2E_DATABASE_URL ?? "";
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "phone-375", use: { browserName: "chromium", viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    // NEXT_PUBLIC_E2E_SCAN_BRIDGE chỉ bật ở đây (cầu nối window.__scanFeed cho test), không bao giờ ở bản build thật.
    env: { DATABASE_URL: url, AUTH_SECRET: "e".repeat(40), NEXT_PUBLIC_E2E_SCAN_BRIDGE: "1" },
  },
});
