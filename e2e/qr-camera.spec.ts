import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Khói: camera giả của Chromium + wasm tự host. `launchOptions` buộc worker riêng nên phải đặt ở cấp file.
test.use({ permissions: ["camera"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });

const classA = () => (JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string }).classA;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

test("camera giả: camera bật được và wasm giải mã tải không lỗi", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const wasm = page.waitForResponse((r) => r.url().endsWith("/zxing_reader.wasm") && r.ok());
  await page.goto("/login");
  await page.getByLabel("Email").fill(test.info().project.name === "tablet-768" ? "glv-a2@e2e.vn" : "glv-a@e2e.vn");
  await page.getByLabel("Mật khẩu").fill("e2e-password-1");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
  await page.goto(`/lop/${classA()}/diem-danh/${today()}/quet`);
  await wasm;
  await expect(page.getByLabel("Hình từ camera")).toBeVisible();
  expect(errors).toEqual([]);
});
