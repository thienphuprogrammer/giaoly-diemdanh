import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classR: string };
const boardPath = () => `/lop/${state().classA}/diem-danh/${todayInVietnam()}`;
async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return await fn(sql); } finally { await sql.end(); }
}

class ResponsiveApp {
  constructor(readonly page: Page) {}
  get navigation() { return this.page.getByRole("navigation", { name: "Điều hướng chính" }); }
  get classNavigation() { return this.page.getByRole("navigation", { name: "Điều hướng lớp" }); }
  async login(email = "glv-a@e2e.vn") {
    await this.page.goto("/login");
    await this.page.getByLabel("Email").fill(email);
    await this.page.getByLabel("Mật khẩu").fill("e2e-password-1");
    await this.page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(this.page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
  }
  async expectNoOverflow() {
    await expect.poll(() => this.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
}

test.beforeEach(async () => {
  await withSql(async (sql) => {
    await sql`delete from sessions where class_id = ${state().classA} and held_on = ${todayInVietnam()}`;
    await sql`update students set active = true where class_id = ${state().classA}`;
  });
});

test("responsive: trang không tràn ngang, sidebar từ 1024px và điều hướng có mục hiện tại", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const app = new ResponsiveApp(page);
  await app.login();
  const widths = testInfo.project.name === "laptop-1280" ? [1024, 1280, 1920] : [page.viewportSize()!.width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
    await app.expectNoOverflow();
    await expect(app.navigation.getByRole("link", { name: "Trang chủ", exact: true })).toHaveAttribute("aria-current", "page");
    const nav = (await app.navigation.boundingBox())!;
    if (width >= 1024) {
      expect(nav.x).toBe(0);
      expect(nav.y).toBe(64);
      expect(nav.width).toBe(240);
      expect(nav.y + nav.height).toBe(900);
      expect((await page.getByRole("main").boundingBox())!.x).toBeGreaterThanOrEqual(240);
    } else {
      expect(nav.width).toBe(width);
      expect(nav.y + nav.height).toBe(900);
      expect(nav.height).toBeLessThan(100);
    }
    await app.navigation.getByRole("link", { name: "Lớp của tôi", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/lop");
    await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
    await expect(app.navigation.getByRole("link", { name: "Lớp của tôi", exact: true })).toHaveAttribute("aria-current", "page");
    await app.expectNoOverflow();
    await page.goto(boardPath());
    await expect(page.getByText("Đã điểm danh 0/4")).toBeVisible();
    await expect(app.classNavigation.getByRole("link", { name: "Điểm danh", exact: true })).toHaveAttribute("aria-current", "page");
    await app.expectNoOverflow();
    await page.screenshot({ path: testInfo.outputPath(`responsive-board-${width}.png`), fullPage: true });
    await app.classNavigation.getByRole("link", { name: "Thiếu nhi", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Danh sách thiếu nhi" })).toBeVisible();
    await expect(app.classNavigation.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(app.classNavigation.getByRole("link", { name: "Thiếu nhi", exact: true })).toHaveAttribute("aria-current", "page");
    await app.expectNoOverflow();
  }
  await page.screenshot({ path: testInfo.outputPath("responsive-roster.png"), fullPage: true });
});

test("responsive: tìm tên có dấu/không dấu và lọc em đang học/đã ẩn", async ({ page }) => {
  const app = new ResponsiveApp(page);
  await app.login();
  await page.goto(`/lop/${state().classA}/thieu-nhi`);
  for (const query of ["Nguyễn Bình", "nguyen binh"]) {
    await page.getByLabel("Tìm thiếu nhi").fill(query);
    await expect(page.getByRole("link", { name: "Nguyễn Bình", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText("Hiển thị 1 / 4 em");
    await expect(page.getByRole("link", { name: "Nguyễn An", exact: true })).toHaveCount(0);
  }
  await page.getByLabel("Tìm thiếu nhi").fill("khong-co-em-nay");
  await expect(page.getByText("Không tìm thấy thiếu nhi phù hợp", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await page.getByRole("combobox", { name: "Trạng thái", exact: true }).selectOption("active");
  const dung = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Nguyễn Dũng", exact: true }) });
  await dung.getByRole("button", { name: "Ẩn", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Hiển thị 3 / 4 em");
  await expect(page.getByLabel("Tìm thiếu nhi")).toBeFocused();
  await expect(page.getByRole("link", { name: "Nguyễn Dũng", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Trạng thái", exact: true }).selectOption("hidden");
  await expect(page.getByRole("status")).toHaveText("Hiển thị 1 / 4 em");
  await expect(page.getByRole("link", { name: "Nguyễn Dũng", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await expect(page.getByRole("status")).toHaveText("Hiển thị 4 / 4 em");
  await app.expectNoOverflow();
});

test("responsive: dialog giữ và trả focus; bộ lọc không làm mất điểm danh cả lớp", async ({ page }) => {
  const app = new ResponsiveApp(page);
  await app.login();
  await page.goto(boardPath());
  await page.getByRole("tab", { name: "Danh sách", exact: true }).click();
  await page.getByLabel("Tìm thiếu nhi").fill("nguyen an");
  await page.getByRole("combobox", { name: "Trạng thái", exact: true }).selectOption("unmarked");
  await expect(page.getByRole("status").filter({ hasText: "Hiển thị" })).toHaveText("Hiển thị 1/4 em");
  const opener = page.getByRole("button", { name: "Lựa chọn khác cho Nguyễn An" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Điểm danh Nguyễn An" });
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 9; step++) {
    await page.keyboard.press("Tab");
    // Dialog gốc có thể chuyển focus tới chrome trình duyệt ở cuối vòng Tab (activeElement là body).
    // Những nút/ô nhập của trang nền phải luôn inert và không bao giờ nhận focus.
    await expect.poll(() => dialog.evaluate((el) => document.activeElement === document.body || el.contains(document.activeElement))).toBe(true);
  }
  if (page.viewportSize()!.width >= 1024) expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(576);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await page.getByRole("listitem").filter({ has: opener }).getByRole("button", { name: "Có", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await expect(page.getByText("Đã điểm danh 1/4")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Hiển thị" })).toHaveText("Hiển thị 0/4 em");
  await expect(page.getByLabel("Tìm thiếu nhi")).toBeFocused();
  await page.getByRole("button", { name: "Tất cả có mặt" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();
  await withSql(async (sql) => {
    const marks = await sql`select a.status from attendance a join sessions se on se.id = a.session_id
      where se.class_id = ${state().classA} and se.held_on = ${todayInVietnam()} and se.kind = 'class'`;
    expect(marks.map((mark) => mark.status)).toEqual(["present", "present", "present", "present"]);
  });
  await page.reload();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();
});

test("responsive: trưởng khối chỉ đọc lớp chưa phân công, không có thao tác ghi", async ({ page }) => {
  const app = new ResponsiveApp(page);
  await app.login();
  await page.goto(boardPath());
  await expect(page.getByText("Đã điểm danh 0/4")).toBeVisible();
  await page.context().clearCookies();
  await app.login("head-a@e2e.vn");
  await page.goto(boardPath());
  await expect(page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Tất cả có mặt" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Quét QR" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Danh sách", exact: true }).click();
  await expect(page.getByRole("button", { name: "Có", exact: true })).toHaveCount(4);
  for (const button of await page.getByRole("button", { name: "Có", exact: true }).all()) await expect(button).toBeDisabled();
  await app.classNavigation.getByRole("link", { name: "Thiếu nhi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ẩn", exact: true })).toHaveCount(0);
  await app.expectNoOverflow();
});

test("responsive: rời trang khi có hai dialog không khoá cuộn trang đích", async ({ page }) => {
  const app = new ResponsiveApp(page);
  await app.login();
  await page.goto(boardPath());
  await expect(page.getByText("Đã điểm danh 0/4")).toBeVisible();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const isBoard = (url: URL) => url.pathname === boardPath();
  await page.route(isBoard, async (route) => {
    if (route.request().method() === "POST") { await held; await route.abort("internetdisconnected"); }
    else await route.continue();
  });
  try {
    const pending = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === boardPath());
    await page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ }).click();
    await pending;
    await page.getByRole("button", { name: "Mở lựa chọn cho Nguyễn Bình" }).click();
    await expect(page.getByRole("dialog", { name: "Điểm danh Nguyễn Bình" })).toBeVisible();
    await page.evaluate(() => history.back());
    const guard = page.getByRole("dialog", { name: "Chưa lưu xong" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Vẫn rời trang" }).click();
    release();
    await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  } finally { release(); await page.unroute(isBoard); }
});

test("responsive: báo cáo cuộn trong khung, bản in không có điều hướng", async ({ page }, testInfo) => {
  const app = new ResponsiveApp(page);
  await app.login("glv-r@e2e.vn");
  await page.goto(`/lop/${state().classR}/thong-ke/bao-cao`);
  await expect(page.getByRole("article", { name: /Báo cáo Lớp R/ }).locator("tbody tr")).toHaveCount(60);
  await app.expectNoOverflow();
  await page.emulateMedia({ media: "print" });
  await expect(app.navigation).toBeHidden();
  await expect(app.classNavigation).toBeHidden();
  await expect(page.getByRole("button", { name: "In / Lưu PDF" })).toBeHidden();
  expect(await page.getByRole("main").evaluate((el) => el.getBoundingClientRect().left)).toBe(0);
  if (testInfo.project.name === "desktop-1440") await page.pdf({ path: testInfo.outputPath("desktop-report.pdf"), preferCSSPageSize: true });
});
