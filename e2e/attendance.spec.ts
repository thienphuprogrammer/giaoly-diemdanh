import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classB: string; classC: string };
const EDIT_NAME = "Trần Sửa"; // khớp e2e/global-setup.ts
const LOGIN_PW = "e2e-password-1";

// global-setup chạy một lần cho cả hai project nên xóa buổi hôm nay trước mỗi test để test độc lập.
test.beforeEach(async () => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`delete from sessions where held_on = ${todayInVietnam()}`;
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string, password = LOGIN_PW) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

test("điểm danh bằng sơ đồ, thấy cảnh báo và danh sách Cần chú ý", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  await page.getByRole("link", { name: /Lớp A/ }).click();
  await page.getByRole("link", { name: "Điểm danh hôm nay" }).click();

  await page.getByRole("button", { name: "Tất cả có mặt" }).click();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();

  // An đã vắng 1 buổi trước đó; chạm để đánh vắng buổi này => đủ 2 buổi => cảnh báo.
  await page.getByRole("button", { name: /Nguyễn An: Có mặt/ }).click();
  await expect(page.getByRole("button", { name: /Nguyễn An: Vắng không phép/ })).toBeVisible();
  await expect(page.getByLabel("Cảnh báo vắng")).toBeVisible();

  // Nhấn giữ mở bảng chọn trạng thái.
  const binh = page.getByRole("button", { name: /Nguyễn Bình: / });
  await binh.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /Điểm danh Nguyễn Bình/ })).toBeVisible();
  await page.getByRole("button", { name: "Vắng có phép" }).click();
  await expect(page.getByRole("button", { name: /Nguyễn Bình: Vắng có phép/ })).toBeVisible();

  // Chế độ checklist dùng cùng dữ liệu.
  await page.getByRole("tab", { name: "Checklist" }).click();
  await expect(page.getByRole("button", { name: "Vắng", exact: true, pressed: true })).toHaveCount(1);

  await page.goto("/can-chu-y");
  await expect(page.getByText("Nguyễn An")).toBeVisible();
  await expect(page.getByText(/Cảnh báo · 2 buổi/)).toBeVisible();
});

test("GLV lớp khác không xem được lớp này", async ({ page }) => {
  await login(page, "glv-b@e2e.vn");
  const response = await page.goto(`/lop/${state().classA}`);
  expect(response?.status()).toBe(404);
});

test("không cuộn ngang trên màn hình điểm danh", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  await page.getByRole("link", { name: /Lớp A/ }).click();
  await page.getByRole("link", { name: "Điểm danh hôm nay" }).click();
  await expect(page.getByText(/Đã điểm danh/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("trưởng khối đặt lại mật khẩu GLV rồi GLV đăng nhập bằng mật khẩu mới", async ({ page, browser }) => {
  const newPw = `moi-${Date.now()}-e2e`;
  await login(page, "head-a@e2e.vn");
  await page.goto("/khoi");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Đặt lại mật khẩu" }) });
  await form.getByLabel("Giáo lý viên").selectOption({ label: "GLV Reset" });
  await form.getByLabel("Mật khẩu mới (10–72 ký tự)").fill(newPw);
  await form.getByRole("button", { name: "Lưu" }).click();
  await expect(form.getByRole("status")).toHaveText("Đã lưu");

  const glvPage = await (await browser.newContext()).newPage();
  await login(glvPage, "glv-reset@e2e.vn", newPw);
  await glvPage.context().close();
});

test("người có quyền ghi sửa tên thiếu nhi ở tab Thiếu nhi và thấy tên mới", async ({ page }) => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`update students set full_name = ${EDIT_NAME} where class_id = ${state().classC}`;
  } finally {
    await sql.end();
  }
  await login(page, "head-a@e2e.vn"); // trưởng khối được gán vào Lớp C nên có quyền ghi
  await page.goto(`/lop/${state().classC}/thieu-nhi`);
  await page.getByRole("button", { name: "Sửa" }).click();
  await page.getByLabel("Họ và tên").fill(`${EDIT_NAME} Xong`);
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText(`${EDIT_NAME} Xong`)).toBeVisible();
});
