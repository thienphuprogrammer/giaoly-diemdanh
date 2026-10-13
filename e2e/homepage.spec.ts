import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as {
  classA: string; classC: string; classQ: string;
};

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return await fn(sql); } finally { await sql.end(); }
}

class HomePage {
  constructor(readonly page: Page) {}
  get main() { return this.page.getByRole("main"); }
  get navigation() { return this.page.getByRole("navigation", { name: "Điều hướng chính" }); }
  get todayPanel() { return this.main.getByRole("region", { name: "Buổi học hôm nay" }); }
  classRow(name: string) {
    return this.todayPanel.getByRole("listitem").filter({ has: this.page.getByRole("link", { name, exact: true }) });
  }
  summaryValue(label: string) {
    return this.main.locator("dl > div").filter({ has: this.page.getByText(label, { exact: true }) }).locator("dd");
  }
  async login(email = "glv-a@e2e.vn") {
    await this.page.goto("/login");
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Mật khẩu").fill("e2e-password-1");
    await this.page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(this.main.getByRole("heading", { name: "Trang chủ", exact: true })).toBeVisible();
    await expect(this.page).toHaveURL((url) => url.pathname === "/");
  }
  async expectFitsViewport() {
    await expect.poll(() => this.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
}

test.beforeEach(async () => {
  await withSql(async (sql) => {
    await sql`delete from sessions where class_id in (${state().classA}, ${state().classC}, ${state().classQ})
      and held_on = ${todayInVietnam()}`;
  });
});

test("trang chủ: tổng quan đúng lớp được giao và chỉ xem trang không tự mở buổi", async ({ page }, testInfo) => {
  const app = new HomePage(page);
  await app.login();
  await expect(app.summaryValue("Lớp")).toHaveText("2");
  await expect(app.summaryValue("Thiếu nhi")).toHaveText("34");
  await expect(app.classRow("Lớp A")).toContainText("Chưa mở buổi");
  await expect(app.classRow("Lớp Q")).toContainText("Chưa mở buổi");
  await expect(app.main.getByRole("link", { name: "Lớp B", exact: true })).toHaveCount(0);
  await expect(app.main.getByRole("link", { name: "Lớp C", exact: true })).toHaveCount(0);
  await expect(app.navigation.getByRole("link", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(app.navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await app.expectFitsViewport();

  // Chạm/hover liên kết tác vụ chỉ xem trước trang, không được tạo dữ liệu điểm danh.
  await app.classRow("Lớp A").getByRole("link", { name: "Điểm danh hôm nay", exact: true }).hover();
  await page.waitForLoadState("networkidle");
  expect(await withSql((sql) => sql`select id from sessions where class_id = ${state().classA}
    and held_on = ${todayInVietnam()} and kind = 'class'`)).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("homepage.png"), fullPage: true });
});

test("trang chủ: mở danh sách lớp, trở lại từ lớp và giữ đúng mục điều hướng", async ({ page }) => {
  const app = new HomePage(page);
  await app.login();
  await app.navigation.getByRole("link", { name: "Lớp của tôi", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/lop");
  await expect(app.main.getByRole("heading", { name: "Lớp của tôi", exact: true })).toBeVisible();
  await expect(app.navigation.getByRole("link", { name: "Lớp của tôi", exact: true })).toHaveAttribute("aria-current", "page");
  await app.main.getByRole("link", { name: /^Lớp A/ }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/lop/${state().classA}`);
  await expect(app.navigation.getByRole("link", { name: "Lớp của tôi", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Về danh sách lớp", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/lop");
  await app.navigation.getByRole("link", { name: "Trang chủ", exact: true }).click();
  await expect(app.main.getByRole("heading", { name: "Trang chủ", exact: true })).toBeVisible();
  await expect(app.navigation.getByRole("link", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(app.navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await app.expectFitsViewport();
});

test("trang chủ: trưởng khối thấy tác vụ chỉ đọc và tác vụ của lớp được phân công", async ({ page }) => {
  const app = new HomePage(page);
  await app.login("head-a@e2e.vn");
  const readOnly = app.classRow("Lớp A");
  await expect(readOnly).toContainText("Chỉ xem");
  await expect(readOnly.getByRole("link", { name: "Xem buổi hôm nay", exact: true })).toBeVisible();
  await expect(readOnly.getByRole("link", { name: "Thống kê", exact: true })).toBeVisible();
  await expect(readOnly.getByRole("link", { name: "Quét QR", exact: true })).toHaveCount(0);
  await expect(readOnly.getByRole("link", { name: "Điểm danh hôm nay", exact: true })).toHaveCount(0);
  await expect(app.classRow("Lớp C").getByRole("link", { name: "Điểm danh hôm nay", exact: true })).toBeVisible();
  await expect(app.classRow("Lớp C").getByRole("link", { name: "Quét QR", exact: true })).toBeVisible();
  await expect(app.main.getByRole("link", { name: "Lớp B", exact: true })).toHaveCount(0);
  await expect(app.navigation.getByRole("link", { name: "Khối", exact: true })).toBeVisible();
  await app.expectFitsViewport();
  await readOnly.getByRole("link", { name: "Xem buổi hôm nay", exact: true }).click();
  await expect(page.getByText(/Chưa có buổi điểm danh ngày/)).toBeVisible();
  expect(await withSql((sql) => sql`select id from sessions where class_id = ${state().classA}
    and held_on = ${todayInVietnam()} and kind = 'class'`)).toHaveLength(0);
});

test("trang chủ: tài khoản chưa được gán lớp có hướng dẫn rõ và vẫn mở được tài khoản", async ({ page }) => {
  const email = `homepage-empty-${randomUUID()}@e2e.vn`;
  const [user] = await withSql((sql) => sql<{ id: string }[]>`insert into users (email, name, password_hash, grade_id)
    select ${email}, 'GLV Chưa Gán Lớp', password_hash, grade_id from users where email = 'glv-a@e2e.vn' returning id`);
  try {
    const app = new HomePage(page);
    await app.login(email);
    await expect(app.main.getByText("Bạn chưa có lớp trong năm học này", { exact: true })).toBeVisible();
    await expect(app.main.getByText(/nhờ trưởng khối/)).toBeVisible();
    await expect(app.main.getByRole("link", { name: "Điểm danh hôm nay", exact: true })).toHaveCount(0);
    await expect(app.main.getByRole("link", { name: "Quét QR", exact: true })).toHaveCount(0);
    await app.expectFitsViewport();
    await app.navigation.getByRole("link", { name: "Tài khoản", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/tai-khoan", { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Tài khoản", exact: true })).toBeVisible();
  } finally {
    await withSql((sql) => sql`delete from users where id = ${user.id}`);
  }
});
