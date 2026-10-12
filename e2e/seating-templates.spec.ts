import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classT: string };
const LOGIN_PW = "e2e-password-1";

// Lớp T chỉ dùng cho file này; xóa sơ đồ trước mỗi test để test độc lập (global-setup chạy một lần cho cả hai project).
test.beforeEach(async () => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`delete from seating_plans where class_id = ${state().classT}`;
  } finally {
    await sql.end();
  }
});

async function openSeating(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("glv-t@e2e.vn");
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
  await page.goto(`/lop/${state().classT}/so-do`);
}

test("tạo sơ đồ từ mẫu Vừa 3 dãy: 4 hàng, 36 chỗ, huy hiệu dư chỗ, xếp một em", async ({ page }) => {
  await openSeating(page);
  await page.getByLabel("Tên sơ đồ").fill("Phòng chính");

  const card = page.getByRole("button", { name: /Vừa 3 dãy/ });
  await expect(card).toContainText("36 chỗ");
  await expect(card).toContainText("lớp 28–36 em");
  await expect(card).toContainText("Dư 6 chỗ");
  await expect(page.getByRole("button", { name: /Hàng đầu nhỏ/ })).toContainText("Dư 14 chỗ");
  await expect(page.getByRole("button", { name: /Truyền thống 3 dãy/ })).toContainText("Dư 20 chỗ");
  await expect(page.getByRole("button", { name: /Lớp nhỏ 2 dãy/ })).toContainText("Thiếu 6 chỗ");
  const box = await card.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await card.click();
  await expect(page).toHaveURL(/\/so-do\?plan=/);
  await expect(page.getByRole("group", { name: /^Hàng \d+$/ })).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Ghế trống" })).toHaveCount(36);

  await page.getByRole("button", { name: "Ghế trống" }).first().click();
  await page.getByRole("button", { name: "Em T01" }).click();
  await expect(page.getByRole("button", { name: "Ghế của Em T01" })).toBeVisible();
  await expect(page.getByText("Chưa xếp chỗ:")).toContainText("29 em");

  // Đã có em ngồi: không còn đề nghị áp mẫu.
  await expect(page.getByText("Dùng mẫu bố cục")).toHaveCount(0);
  // Không cuộn ngang cả trang trên điện thoại.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("sơ đồ trống rồi áp mẫu Nhóm băng dài khi chưa xếp em nào", async ({ page }) => {
  await openSeating(page);
  await page.getByLabel("Tên sơ đồ").fill("Tự chỉnh");
  await page.getByRole("button", { name: /Sơ đồ trống/ }).click();
  await expect(page.getByRole("group", { name: /^Hàng \d+$/ })).toHaveCount(3);

  await page.getByText("Dùng mẫu bố cục").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("details").getByRole("button", { name: /Nhóm băng dài/ }).click();
  await expect(page.getByRole("group", { name: /^Hàng \d+$/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Ghế trống" })).toHaveCount(24);
});
