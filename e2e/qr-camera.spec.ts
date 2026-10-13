import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";

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
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
  await page.goto(`/lop/${classA()}/diem-danh/${today()}/quet`);
  await wasm;
  const video = page.getByLabel("Hình từ camera");
  await expect(video).toBeVisible();
  // iOS chỉ phát camera nội tuyến khi video có đủ playsinline + muted + autoplay.
  // (React đặt `muted` bằng thuộc tính DOM, không ra attribute HTML, nên đọc thuộc tính.)
  expect(await video.evaluate((v: HTMLVideoElement) => ({ inline: v.playsInline, muted: v.muted, auto: v.autoplay })))
    .toEqual({ inline: true, muted: true, auto: true });
  // Chặn zoom/kéo nảy chỉ ở màn quét.
  const styles = await page.evaluate(() => ({
    touch: getComputedStyle(document.querySelector(".scan-screen")!).touchAction,
    overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
    callout: getComputedStyle(document.querySelector(".scan-viewfinder")!).userSelect,
  }));
  expect(styles).toEqual({ touch: "pan-x pan-y", overscroll: "none", callout: "none" });
  expect(errors).toEqual([]);
});
