import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./fixtures";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classP: string; kidWithPhone: string; kidNoPhone: string };
const LOGIN_PW = "e2e-password-1";

// Cả hai project dùng chung dữ liệu: đưa em mẫu về trạng thái ban đầu trước mỗi test.
test.beforeEach(async () => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`update students set parent_phone = '0901234567', note = 'Hay quên sách' where id = ${state().kidWithPhone}`;
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
}

test("mở hồ sơ từ danh sách thiếu nhi, thấy thống kê, lịch sử buổi và nút liên hệ", async ({ page }) => {
  await login(page, "glv-p@e2e.vn");
  await page.goto(`/lop/${state().classP}/thieu-nhi`);
  await page.getByRole("link", { name: /Lê Hồ Sơ/ }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classP}/thieu-nhi/${state().kidWithPhone}$`));
  await expect(page.getByRole("heading", { name: "Lê Hồ Sơ" })).toBeVisible();
  await expect(page.getByText("Hay quên sách")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();
  await expect(page.getByText("Lý do: Về quê")).toBeVisible();
  await expect(page.getByRole("list").getByText("Vắng không phép")).toBeVisible();

  await expect(page.getByRole("link", { name: "Gọi", exact: true })).toHaveAttribute("href", "tel:0901234567");
  await expect(page.getByRole("link", { name: "Nhắn Zalo" })).toHaveAttribute("href", "https://zalo.me/84901234567");
  await expect(page.getByRole("link", { name: "SMS" })).toHaveAttribute("href", "sms:0901234567");
  const box = await page.getByRole("link", { name: "Gọi", exact: true }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Mã QR không lọt vào HTML của trang.
  expect(await page.content()).not.toMatch(/qr_?token/i);
});

test("em chưa có số phụ huynh: ẩn nút liên hệ và nhắc nhập số", async ({ page }) => {
  await login(page, "glv-p@e2e.vn");
  await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidNoPhone}`);
  await expect(page.getByText(/Chưa có số phụ huynh/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Nhắn Zalo" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Gọi", exact: true })).toHaveCount(0);
});

test("mở hồ sơ từ Cần chú ý, có nút Gọi phụ huynh khi có số", async ({ page }) => {
  await login(page, "glv-p@e2e.vn");
  await page.goto("/can-chu-y");
  await expect(page.getByText("Chưa có số phụ huynh")).toBeVisible();
  await expect(page.getByRole("link", { name: /Gọi phụ huynh Phạm/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Gọi phụ huynh/ })).toHaveAttribute("href", "tel:0901234567");
  const call = page.getByRole("link", { name: /Gọi phụ huynh/ });
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("link", { name: "Phạm Chưa Số" }).click();
  await expect(page).toHaveURL(new RegExp(`/thieu-nhi/${state().kidNoPhone}$`));
  await expect(page.getByRole("heading", { name: "Phạm Chưa Số" })).toBeVisible();
});

test("GLV sửa ghi chú và SĐT; số được chuẩn hoá, số sai bị từ chối", async ({ page }) => {
  await login(page, "glv-p@e2e.vn");
  await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidWithPhone}`);
  await page.getByRole("button", { name: "Sửa ghi chú và SĐT" }).click();
  await page.getByLabel("SĐT phụ huynh").fill("12 34");
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "SĐT không hợp lệ" })).toBeVisible();

  await page.getByLabel("SĐT phụ huynh").fill("+84 912 345 678");
  await page.getByLabel("Ghi chú").fill("Dị ứng đậu phộng");
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText("Dị ứng đậu phộng")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gọi", exact: true })).toHaveAttribute("href", "tel:0912345678");
  await expect(page.getByRole("link", { name: "Nhắn Zalo" })).toHaveAttribute("href", "https://zalo.me/84912345678");
});

test("trưởng khối không được phân công chỉ đọc: thấy hồ sơ nhưng không có nút sửa", async ({ page }) => {
  await login(page, "head-a@e2e.vn");
  await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidWithPhone}`);
  await expect(page.getByRole("heading", { name: "Lê Hồ Sơ" })).toBeVisible();
  await expect(page.getByText("Chỉ xem")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sửa ghi chú và SĐT" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Gọi", exact: true })).toBeVisible();
});

test("trưởng khối chỉ đọc thấy hồ sơ em chưa có số mà không bị bảo bấm Sửa", async ({ page }) => {
  await login(page, "head-a@e2e.vn");
  await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidNoPhone}`);
  await expect(page.getByText("Chưa có số phụ huynh.")).toBeVisible();
  await expect(page.getByText(/Bấm "Sửa/)).toHaveCount(0);
});

test("người ngoài quyền đọc lớp và id lạ đều nhận 404 như nhau", async ({ page }) => {
  await login(page, "glv-b@e2e.vn");
  const outsider = await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidWithPhone}`);
  expect(outsider!.status()).toBe(404);
  const unknown = await page.goto(`/lop/${state().classP}/thieu-nhi/00000000-0000-4000-8000-000000000000`);
  expect(unknown!.status()).toBe(404);
});

test("trưởng khối của khối khác nhận 404 như người lạ", async ({ page }) => {
  await login(page, "head-b@e2e.vn");
  const res = await page.goto(`/lop/${state().classP}/thieu-nhi/${state().kidWithPhone}`);
  expect(res!.status()).toBe(404);
});
