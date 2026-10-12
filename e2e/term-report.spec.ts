import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classR: string; gradeE: string; classA: string };
const LOGIN_PW = "e2e-password-1";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Số trang của PDF Chromium: đếm đối tượng /Type /Page (không phải /Pages). */
function pdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const byType = (text.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
  // Phương án hai: /Count của nút /Pages gốc (số lớn nhất).
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const byCount = counts.length ? Math.max(...counts) : 0;
  const pages = Math.max(byType, byCount);
  if (pages === 0) throw new Error("Không đếm được số trang của PDF");
  return pages;
}

test("báo cáo lớp: tiêu đề, học kỳ, cột, nút In, không tràn ngang, không lộ SĐT/mã QR", async ({ page }) => {
  await login(page, "glv-r@e2e.vn");
  await page.goto(`/lop/${state().classR}/thong-ke`);
  await page.getByRole("link", { name: "Báo cáo in được" }).click();
  await expect(page).toHaveURL(/\/thong-ke\/bao-cao\?termId=/);
  const sheet = page.getByRole("article", { name: /Báo cáo Lớp R Học kỳ E2E/ });
  await expect(sheet.getByRole("heading", { level: 1, name: /Báo cáo chuyên cần · Lớp R/ })).toBeVisible();
  await expect(sheet.getByText("Học kỳ E2E (")).toBeVisible();
  await expect(sheet.getByText("Khối E2E E")).toBeVisible();
  await expect(sheet.getByText("GLV R")).toBeVisible();
  for (const name of ["STT", "Tên thánh", "Họ tên", "Có mặt", "Muộn", "Vắng có phép", "Vắng không phép", "% chuyên cần", "Đi lễ (đi/đã ghi)", "Cảnh báo"]) {
    await expect(sheet.getByRole("columnheader", { name, exact: true })).toBeVisible();
  }
  await expect(sheet.locator("tbody tr")).toHaveCount(60);
  const row10 = sheet.locator("tbody tr", { hasText: "Em R10" });
  await expect(row10).toContainText("Cảnh báo: ≥2 vắng KP");
  await expect(sheet.locator("tbody tr", { hasText: "Em R12" })).toContainText("Vắng lễ ≥ ngưỡng");
  await expect(sheet.locator("tfoot")).toContainText("Tổng cộng (60 em)");
  await expect(sheet.locator("tfoot")).toContainText("90%");
  await expect(sheet.locator("tfoot")).toContainText("95/120");
  await expect(page.getByRole("button", { name: "In / Lưu PDF" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Thống kê" })).toBeVisible();
  // Điện thoại: bảng cuộn ngang trong khung riêng, trang không tràn.
  expect(await noOverflow(page)).toBe(true);
  expect(await page.locator(".report-scroll").first().evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");

  // Riêng tư: không SĐT, không mã QR trong HTML.
  const html = await page.content();
  expect(html).not.toContain("09123450");
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    const tokens = await sql<{ qr_token: string }[]>`select qr_token from students where class_id = ${state().classR}`;
    expect(tokens.length).toBe(60);
    for (const { qr_token } of tokens) expect(html).not.toContain(qr_token);
  } finally {
    await sql.end();
  }
});

test("báo cáo lớp: PDF A4 có nhiều trang với 60 em, nút In và thanh công cụ không in", async ({ page }) => {
  await login(page, "glv-r@e2e.vn");
  await page.goto(`/lop/${state().classR}/thong-ke/bao-cao`);
  await expect(page.locator("tbody tr")).toHaveCount(60);
  const pdf = await page.pdf({ format: "A4", margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" } });
  expect(pdf.length).toBeGreaterThan(1000);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pdfPages(pdf)).toBeGreaterThanOrEqual(2); // 60 dòng ở cỡ chữ in không thể vừa một trang A4
  const cssSized = await page.pdf({ preferCSSPageSize: true });
  expect(pdfPages(cssSized)).toBeGreaterThanOrEqual(2);
  // Ở chế độ in, thanh công cụ và thanh điều hướng bị ẩn, tiêu đề bảng lặp lại.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "In / Lưu PDF" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toBeHidden();
  const display = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).display);
  expect(await display("thead")).toBe("table-header-group"); // lặp tiêu đề mỗi trang
  expect(await display("tfoot")).toBe("table-row-group"); // mặc định là table-footer-group (lặp mỗi trang); báo cáo chỉ cần tổng ở cuối
  expect(await page.locator("tbody tr").first().evaluate((el) => getComputedStyle(el).breakInside)).toBe("avoid");
});

test("báo cáo lớp: người ngoài quyền đọc lớp nhận 404; trưởng khối đọc được", async ({ page }) => {
  await login(page, "glv-b@e2e.vn");
  const res = await page.goto(`/lop/${state().classR}/thong-ke/bao-cao`);
  expect(res!.status()).toBe(404);
  await page.context().clearCookies();
  await login(page, "head-e@e2e.vn");
  const ok = await page.goto(`/lop/${state().classR}/thong-ke/bao-cao`);
  expect(ok!.status()).toBe(200);
  await expect(page.locator("tbody tr")).toHaveCount(60);
});

test("báo cáo khối: trưởng khối thấy tổng hợp lớp, danh sách cảnh báo, tải Excel đúng; GLV nhận 404", async ({ page }) => {
  await login(page, "head-e@e2e.vn");
  await page.goto("/khoi");
  await page.getByRole("link", { name: /Báo cáo học kỳ của khối/ }).click();
  await expect(page).toHaveURL(/\/khoi\/bao-cao\?termId=/);
  const sheet = page.getByRole("article", { name: /Báo cáo Khối E2E E/ });
  await expect(sheet.getByRole("heading", { level: 1, name: /Báo cáo tổng hợp · Khối E2E E/ })).toBeVisible();
  const row = sheet.locator("tbody tr").first();
  await expect(row.locator("td")).toHaveText(["Lớp R", "60", "3", "90%", "6", "5", "2"]);
  await expect(sheet.getByRole("heading", { name: "Em đang cảnh báo (đang học ở lớp) (10)" })).toBeVisible();
  await expect(sheet.getByRole("row", { name: /Em R60.*Vắng KP 2 buổi; Vắng lễ 2 tuần/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "In / Lưu PDF" })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  const html = await page.content();
  expect(html).not.toContain("09123450");

  const pdf = await page.pdf({ format: "A4" });
  expect(pdfPages(pdf)).toBeGreaterThanOrEqual(1);

  const termId = new URL(page.url()).searchParams.get("termId")!;
  const res = await page.request.get(`/khoi/bao-cao/export?termId=${termId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  const disposition = res.headers()["content-disposition"];
  expect(disposition).toContain("attachment");
  expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe("tong-hop-khoi-Khối-E2E-E-Học-kỳ-E2E.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
  expect(wb.worksheets.map((w) => w.name)).toEqual(["Tổng hợp khối", "Cảnh báo"]);
  expect(wb.getWorksheet("Tổng hợp khối")!.getRow(2).values).toEqual([undefined, "Lớp R", 60, 3, 0.9, 6, 5, 2]);
  const warn = wb.getWorksheet("Cảnh báo")!;
  expect(warn.rowCount).toBe(11);
  const cells = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));
  expect(cells).not.toContain("09123450");

  await page.context().clearCookies();
  await login(page, "glv-r@e2e.vn");
  expect((await page.goto("/khoi/bao-cao"))!.status()).toBe(404);
  expect((await page.request.get(`/khoi/bao-cao/export?termId=${termId}`)).status()).toBe(404);
  await page.context().clearCookies();
  await login(page, "head-b@e2e.vn");
  const other = await page.request.get(`/khoi/bao-cao/export?termId=${termId}`);
  expect(other.status()).toBe(200); // trưởng khối khác chỉ nhận báo cáo của khối mình
  const otherWb = new ExcelJS.Workbook();
  await otherWb.xlsx.load((await other.body()) as unknown as ArrayBuffer);
  expect(JSON.stringify(otherWb.worksheets.map((w) => w.getSheetValues()))).not.toContain("Lớp R");
  await page.context().clearCookies();
  // Chưa đăng nhập: proxy chuyển về /login (như mọi trang); không bao giờ trả file.
  const anon = await page.request.get(`/khoi/bao-cao/export?termId=${termId}`, { maxRedirects: 0 });
  expect(anon.status()).toBeGreaterThanOrEqual(300);
  expect(anon.status()).toBeLessThan(400);
  expect(anon.headers()["location"]).toContain("/login");
});
