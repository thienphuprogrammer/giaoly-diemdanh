import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { hashPassword } from "../src/lib/auth/password";
import { expect, test, type Page } from "./fixtures";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { gradeA: string; year: string; nextYear: string; classA: string; nextClassA: string; admin: string };
async function query<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return await fn(sql); } finally { await sql.end(); }
}
async function login(page: Page, email = "admin@giaoly.local", password = "e2e-password-1") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ", exact: true })).toBeVisible();
}
const operation = (page: Page, intent: string) => page.locator("form").filter({ has: page.locator(`input[name="intent"][value="${intent}"]`) });
const filter = (page: Page) => page.locator("form").filter({ has: page.getByRole("button", { name: "Lọc danh sách", exact: true }) });
async function fits(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }

test("admin: xem mọi khối và tài khoản khối trưởng, giáo lý viên", async ({ page }) => {
  await login(page);
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quản trị", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quản trị hệ thống" })).toBeVisible();
  const accounts = page.getByRole("list", { name: "Danh sách tài khoản" });
  await expect(accounts.getByText("head-a@e2e.vn", { exact: true })).toBeVisible();
  await expect(accounts.getByText("head-b@e2e.vn", { exact: true })).toBeVisible();
  await expect(accounts.getByText("glv-b@e2e.vn", { exact: true })).toBeVisible();
  const invalidYear = await page.request.get(`/khoi/bao-cao/export?gradeId=${state().gradeA}&schoolYearId=not-a-uuid`);
  expect(invalidYear.status()).toBe(404);
  await fits(page);
});

test("admin: giáo lý viên và khối trưởng không vào được quản trị toàn hệ thống", async ({ page }) => {
  for (const email of ["glv-a@e2e.vn", "head-a@e2e.vn"]) {
    await page.context().clearCookies();await login(page, email);
    await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Quản trị", exact: true })).toHaveCount(0);
    await page.goto("/quan-tri");await expect(page).toHaveURL((url) => url.pathname === "/");
    await page.goto("/quan-tri/nam-hoc");await expect(page).toHaveURL((url) => url.pathname === "/");
  }
});

test("admin: tạo tài khoản khối trưởng và khóa cả phiên đang đăng nhập", async ({ page, browser }) => {
  const email = `head-created-${randomUUID()}@e2e.vn`;
  const password = "e2e-head-created-1";
  await login(page);await page.goto("/quan-tri");
  await page.locator("summary").filter({ hasText: /^Tạo tài khoản mới$/ }).click();
  const form = operation(page, "create-account");
  await form.locator('input[name="name"]').fill("Khối trưởng mới");
  await form.locator('input[name="email"]').fill(email);await form.locator('input[name="password"]').fill(password);
  await form.locator('select[name="role"]').selectOption("head");await form.locator('select[name="gradeId"]').selectOption(state().gradeA);
  await form.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
  const row = page.getByRole("list", { name: "Danh sách tài khoản" }).getByRole("listitem").filter({ hasText: email });
  await expect(row).toBeVisible();await row.locator("summary").click();
  const other = await browser.newContext();const target = await other.newPage();
  try {
    await login(target, email, password);
    await row.getByRole("button", { name: "Khoá tài khoản", exact: true }).click();
    await page.getByRole("dialog", { name: "Xác nhận: Khoá tài khoản" }).getByRole("button", { name: "Xác nhận", exact: true }).click();
    await expect.poll(async () => (await query((sql) => sql`select is_active from users where email = ${email}`))[0]?.is_active).toBe(false);
    await target.reload();await expect(target).toHaveURL(/\/login/);
    await expect(row.getByText("Đã khoá", { exact: true })).toBeVisible();
  } finally { await other.close(); }
});

test("admin: đặt lại mật khẩu cần mật khẩu của chính admin, và không có đường tự đặt lại", async ({ page, browser }) => {
  const email = `reset-target-${randomUUID()}@e2e.vn`;
  const newPassword = "e2e-reset-by-admin-2";
  await query(async (sql) => sql`insert into users (email, name, password_hash) values (${email}, ${"GLV đặt lại MK"}, ${await hashPassword("e2e-password-1")})`);
  await login(page);await page.goto("/quan-tri");
  const accounts = page.getByRole("list", { name: "Danh sách tài khoản" });
  // The signed-in admin's own row offers no reset form (self-service change only, at /tai-khoan).
  const self = accounts.getByRole("listitem").filter({ hasText: "admin@giaoly.local" });
  await self.locator("summary").click();
  await expect(operation(page, "reset-account-password").filter({ has: page.locator(`input[name="userId"][value="${state().admin}"]`) })).toHaveCount(0);
  const row = accounts.getByRole("listitem").filter({ hasText: email });
  await row.locator("summary").click();
  const form = row.locator("form").filter({ has: page.locator('input[name="intent"][value="reset-account-password"]') });
  const submit = async (actorPassword: string) => {
    await form.locator('input[name="password"]').fill(newPassword);
    await form.locator('input[name="currentPassword"]').fill(actorPassword);
    await form.getByRole("button", { name: "Đặt lại mật khẩu", exact: true }).click();
    await page.getByRole("dialog", { name: "Xác nhận: Đặt lại mật khẩu" }).getByRole("button", { name: "Xác nhận", exact: true }).click();
  };
  await expect(form.getByLabel("Mật khẩu của bạn")).toHaveAttribute("autocomplete", "current-password");
  await submit("khong-phai-mat-khau");
  await expect(form.getByRole("alert")).toHaveText("Mật khẩu của bạn không đúng");
  await submit("e2e-password-1");
  await expect(form.getByRole("status")).toHaveText("Đã lưu thay đổi");
  const other = await browser.newContext();
  try { await login(await other.newPage(), email, newPassword); } finally { await other.close(); }
});

test("admin: cùng tên lớp ở hai năm vẫn tách riêng và năm được giữ khi trở lại danh sách", async ({ page }) => {
  const name = `Lớp thử ${randomUUID().slice(0, 8)}`;
  await login(page);await page.goto("/quan-tri?section=classes");
  await page.locator("summary").filter({ hasText: /^Tạo lớp mới$/ }).click();
  const form = operation(page, "create-class");
  for (const schoolYearId of [state().year, state().nextYear]) {
    await form.locator('input[name="name"]').fill(name);await form.locator('select[name="gradeId"]').selectOption(state().gradeA);
    await form.locator('select[name="schoolYearId"]').selectOption(schoolYearId);
    await form.getByRole("button", { name: "Tạo lớp", exact: true }).click();
    await expect.poll(async () => (await query((sql) => sql`select id from classes where name = ${name} and school_year_id = ${schoolYearId}`)).length).toBe(1);
  }
  await filter(page).locator('select[name="schoolYearId"]').selectOption(state().nextYear);
  await filter(page).getByRole("button", { name: "Lọc danh sách", exact: true }).click();
  const list = page.getByRole("list", { name: "Danh sách lớp quản trị" });
  const row = list.getByRole("listitem").filter({ hasText: name });await expect(row).toHaveCount(1);
  await expect(row).toContainText("Năm kế tiếp E2E");await row.locator("summary").click();
  await row.getByRole("link", { name: "Mở lớp và danh sách thiếu nhi", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("Năm học Năm kế tiếp E2E", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Về danh sách lớp", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/lop" && url.searchParams.get("schoolYearId") === state().nextYear);
  await fits(page);
});

test("admin: tạo, đổi tên và xóa một năm chưa có lớp", async ({ page }) => {
  const name = `Năm thử ${randomUUID().slice(0, 8)}`, renamed = `${name} sửa`;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  await login(page);await page.goto("/quan-tri/nam-hoc");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Tạo năm học mới", exact: true }) });
  await form.locator('input[name="name"]').fill(name);
  for (const [field, offset] of [["term1Start", 501], ["term1End", 550], ["term2Start", 551], ["term2End", 600]] as const) {
    await form.locator(`input[name="${field}"]`).fill(day(offset));
  }
  await form.getByRole("button", { name: "Tạo năm học", exact: true }).click();
  const years = page.getByRole("list", { name: "Các năm học" });
  await expect(years.getByText(name, { exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: /^Đổi tên năm học$/ }).click();
  const rename = operation(page, "rename-school-year").filter({ has: page.getByLabel(`Tên năm học ${name}`, { exact: true }) });
  await rename.locator('input[name="name"]').fill(renamed);await rename.getByRole("button", { name: "Lưu tên năm học", exact: true }).click();
  await expect(years.getByText(renamed, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Xoá năm học ${renamed}`, exact: true }).click();
  await years.getByRole("button", { name: "Xoá năm học", exact: true }).click();
  await expect(years.getByText(renamed, { exact: true })).toHaveCount(0);
  await fits(page);
});

test("admin: chuyển sang năm mới giữ hồ sơ và danh sách lớp cũ, hoàn tác được", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8), from = randomUUID(), to = randomUUID(), kid = randomUUID();
  const fromName = `Nguồn ${suffix}`, toName = `Đích ${suffix}`, kidName = `Em ${suffix}`;
  const before = await query(async sql => {
    await sql`insert into classes (id,name,grade_id,school_year_id) values (${from},${fromName},${state().gradeA},${state().year}), (${to},${toName},${state().gradeA},${state().nextYear})`;
    return (await sql`insert into students (id,class_id,full_name) values (${kid},${from},${kidName}) returning qr_token`)[0].qr_token;
  });
  await login(page);await page.goto("/quan-tri/nam-hoc");
  await page.getByRole("combobox", { name: "Lớp hiện tại", exact: true }).selectOption(from);
  await page.getByRole("combobox", { name: /^Lên lớp/ }).selectOption(to);
  await page.getByRole("button", { name: "Xem danh sách em", exact: true }).click();
  await expect(page.getByRole("list", { name: "Các em sẽ lên lớp" }).getByText(kidName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lên lớp 1 em", exact: true }).click();
  await page.getByRole("dialog", { name: "Xác nhận lên lớp" }).getByRole("button", { name: "Xác nhận lên lớp", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Đã chuyển 1 em từ ${fromName} (E2E) sang ${toName} (Năm kế tiếp E2E).` })).toBeVisible();
  const after = await query(sql => sql`select class_id,qr_token from students where id = ${kid}`);
  expect(after[0]).toMatchObject({ class_id: to, qr_token: before });
  await page.goto(`/lop/${from}/thieu-nhi`);
  await expect(page.getByText(kidName, { exact: true })).toBeVisible();
  const formerRow = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: kidName, exact: true }) });
  await expect(formerRow).toContainText("Đã chuyển lớp");
  await expect(formerRow.getByRole("button", { name: "Sửa", exact: true })).toHaveCount(0);
  await page.goto("/quan-tri/nam-hoc");
  await page.getByRole("button", { name: `Hoàn tác lên lớp ${fromName} → ${toName}`, exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận hoàn tác", exact: true }).click();
  await expect.poll(async () => (await query(sql => sql`select class_id from students where id = ${kid}`))[0].class_id).toBe(from);
  const memberships = await query(sql => sql`select class_id from class_memberships where student_id = ${kid}`);
  expect(memberships.map(m => m.class_id)).toEqual([from]);
  await fits(page);
});
