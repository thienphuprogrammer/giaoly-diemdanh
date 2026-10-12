import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { gradeC: string; classM: string; kidMassWarn: string; kidMassOne: string };
const LOGIN_PW = "e2e-password-1";

/** Khối C luôn bắt đầu với ngưỡng mặc định 2 (test đổi ngưỡng tự khôi phục, nhưng phòng khi test trước dừng giữa chừng). */
async function resetThreshold() {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`update grades set mass_threshold = 2 where id = ${state().gradeC}`;
  } finally {
    await sql.end();
  }
}
test.beforeEach(resetThreshold);
test.afterEach(resetThreshold);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("hồ sơ em có khối Đi lễ: số tuần đi/vắng, từng tuần ✓/✗ và cảnh báo khi chạm ngưỡng", async ({ page }) => {
  await login(page, "glv-mc@e2e.vn");
  await page.goto(`/lop/${state().classM}/thieu-nhi/${state().kidMassWarn}`);
  const block = page.getByRole("region", { name: /^Đi lễ/ });
  await expect(block).toBeVisible();
  await expect(block.getByText("Cảnh báo · vắng lễ 2 tuần")).toBeVisible();
  const weeks = block.getByRole("list", { name: "Các tuần đi lễ đã ghi" }).getByRole("listitem");
  await expect(weeks).toHaveCount(3);
  await expect(weeks.filter({ hasText: "Vắng lễ" })).toHaveCount(2);
  await expect(weeks.filter({ hasText: "Đi lễ" })).toHaveCount(1);
  await expect(block.getByText(/vắng lễ từ 2 tuần/)).toBeVisible();
  expect(await noOverflow(page)).toBe(true);

  // Em mới vắng 1 tuần (ngưỡng - 1): không có cảnh báo.
  await page.goto(`/lop/${state().classM}/thieu-nhi/${state().kidMassOne}`);
  await expect(page.getByRole("region", { name: /^Đi lễ/ }).getByRole("list").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText(/Cảnh báo · vắng lễ/)).toHaveCount(0);
});

test("Cần chú ý có nhóm Đi lễ riêng với nút Gọi phụ huynh", async ({ page }) => {
  await login(page, "glv-mc@e2e.vn");
  await page.goto("/can-chu-y");
  const mass = page.getByRole("region", { name: "Đi lễ" });
  await expect(mass).toBeVisible();
  await expect(mass.getByRole("link", { name: "Võ Vắng Lễ", exact: true })).toBeVisible();
  await expect(mass.getByText("Đi lễ · vắng lễ 2 tuần")).toBeVisible();
  await expect(mass.getByText("Hồ Vắng Một")).toHaveCount(0);
  const call = mass.getByRole("link", { name: /Gọi phụ huynh Võ Vắng Lễ/ });
  await expect(call).toHaveAttribute("href", "tel:0907654321");
  expect((await call.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // Không ai vắng buổi học ở lớp M: không có nhóm buổi học, và đi lễ không bị tính là vắng buổi học.
  await expect(page.getByText(/Cảnh báo · \d+ buổi/)).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
});

test("trưởng khối đổi ngưỡng đi lễ ở trang Khối và cảnh báo đổi theo", async ({ page }) => {
  await login(page, "head-c@e2e.vn");
  await page.goto("/khoi");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Ngưỡng cảnh báo đi lễ" }) });
  const input = form.getByLabel(/Số tuần vắng lễ/);
  await expect(input).toHaveValue("2");
  expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await input.fill("1");
  await form.getByRole("button", { name: "Lưu ngưỡng" }).click();
  await expect(form.getByRole("status")).toHaveText("Đã lưu ngưỡng đi lễ");
  await expect(form.getByText(/vắng lễ từ 1 tuần/)).toBeVisible();

  await page.goto("/can-chu-y");
  const mass = page.getByRole("region", { name: "Đi lễ" });
  await expect(mass.getByRole("link", { name: "Hồ Vắng Một", exact: true })).toBeVisible();
  await expect(mass.getByText("Đi lễ · vắng lễ 1 tuần")).toBeVisible();
  await expect(mass.getByRole("link", { name: "Võ Vắng Lễ", exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test("GLV không có form ngưỡng; xuất Excel thống kê có thêm sheet Đi lễ", async ({ page }) => {
  await login(page, "glv-mc@e2e.vn");
  await page.goto("/khoi");
  await expect(page.getByRole("heading", { name: "Ngưỡng cảnh báo đi lễ" })).toHaveCount(0);

  const res = await page.request.get(`/lop/${state().classM}/thong-ke/export`);
  expect(res.status()).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Lớp M", "Đi lễ"]);
  const ws = wb.getWorksheet("Đi lễ")!;
  const header = (ws.getRow(1).values as unknown[]).slice(1);
  expect(header.slice(0, 3)).toEqual(["STT", "Tên thánh", "Họ tên"]);
  expect(header.slice(-4)).toEqual(["Tuần đã tính", "Đi lễ", "Vắng lễ", "Cảnh báo"]);
  expect(header).toHaveLength(3 + 3 + 4);
  const rows = new Map<string, unknown[]>();
  ws.eachRow((row, n) => { if (n > 1) rows.set(String(row.getCell(3).value), (row.values as unknown[]).slice(1)); });
  expect(rows.get("Võ Vắng Lễ")!.slice(3)).toEqual(["✓", "✗", "✗", 3, 1, 2, "Cảnh báo"]);
  expect(rows.get("Hồ Vắng Một")!.slice(3)).toEqual(["✓", "✓", "✗", 3, 2, 1, ""]);
  expect(rows.get("Đỗ Lễ Đều")!.slice(3)).toEqual(["✓", "✓", "✓", 3, 3, 0, ""]);
  // Sheet buổi học giữ nguyên cột cũ.
  expect((wb.worksheets[0].getRow(1).values as unknown[]).slice(1, 9)).toEqual(["STT", "Tên thánh", "Họ tên", "Có mặt", "Đi muộn", "Vắng có phép", "Vắng không phép", "Cảnh báo"]);
});
