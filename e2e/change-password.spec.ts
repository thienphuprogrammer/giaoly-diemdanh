import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";
import { hashPassword } from "../src/lib/auth/password";

const OLD_PW = "e2e-password-1";
const NEW_PW = "e2e-mat-khau-moi-2";

/** Mỗi test (và mỗi project) một tài khoản riêng, không thuộc khối nào: đổi mật khẩu không ảnh hưởng test khác. */
const pwUser = (slug: string) => `pw-${slug}-${test.info().project.name}@e2e.vn`;

async function resetUser(email: string): Promise<string> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    const hash = await hashPassword(OLD_PW);
    const [row] = await sql<{ id: string }[]>`insert into users (email, name, password_hash) values (${email}, ${"GLV Đổi MK"}, ${hash})
      on conflict (email) do update set password_hash = excluded.password_hash, password_changed_at = null returning id`;
    // Login attempts are keyed by email; change-password attempts by `acct:<user id>` (separate counter).
    await sql`delete from login_attempts where email in (${email}, ${`acct:${row.id}`})`;
    await sql`delete from audit_events where entity_id = ${row.id} and action = 'account.change_password'`;
    return row.id;
  } finally {
    await sql.end();
  }
}

async function changeAudits(userId: string): Promise<number> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql`select summary::text as summary from audit_events where entity_id = ${userId} and action = 'account.change_password'`;
    for (const row of rows) expect(row.summary).not.toMatch(/e2e-|mat-khau|\$2[aby]\$/);
    return rows.length;
  } finally {
    await sql.end();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
}

const passwordForm = (page: Page) => page.getByRole("form", { name: "Đổi mật khẩu" });

async function changePassword(page: Page, current: string, next: string, confirm = next) {
  const form = passwordForm(page);
  await form.getByLabel("Mật khẩu hiện tại").fill(current);
  await form.getByLabel("Mật khẩu mới", { exact: true }).fill(next);
  await form.getByLabel("Nhập lại mật khẩu mới").fill(confirm);
  await form.getByRole("button", { name: "Đổi mật khẩu" }).click();
}

test("đổi mật khẩu: thiết bị này vẫn đăng nhập, thiết bị khác bị đăng xuất ở request kế tiếp", async ({ page, browser }) => {
  const email = pwUser("two");
  await resetUser(email);
  const other = await (await browser.newContext()).newPage();
  try {
    await login(page, email, OLD_PW);
    await login(other, email, OLD_PW);
    await other.goto("/tai-khoan");
    await expect(other.getByRole("heading", { name: "Tài khoản" })).toBeVisible();

    await page.goto("/tai-khoan");
    await changePassword(page, OLD_PW, NEW_PW);
    await expect(passwordForm(page).getByRole("status")).toHaveText("Đã đổi mật khẩu. Các thiết bị khác sẽ bị đăng xuất.");

    // Thiết bị đã đổi: tải lại vẫn ở trang Tài khoản (phiên được cấp lại).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tài khoản" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();

    // Thiết bị kia: request kế tiếp bị chuyển về /login (giữ đường dẫn để quay lại sau khi đăng nhập).
    await other.goto("/tai-khoan");
    await expect(other).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === "/tai-khoan");
    await other.getByLabel("Email").fill(email);
    await other.getByLabel("Mật khẩu").fill(NEW_PW);
    await other.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(other).toHaveURL((u) => u.pathname === "/tai-khoan");
  } finally {
    await other.context().close();
  }
});

test("đổi mật khẩu rồi đăng xuất: mật khẩu cũ không còn dùng được, mật khẩu mới đăng nhập được", async ({ page }) => {
  const email = pwUser("relogin");
  const userId = await resetUser(email);
  await login(page, email, OLD_PW);
  await page.goto("/tai-khoan");
  await changePassword(page, OLD_PW, NEW_PW);
  await expect(passwordForm(page).getByRole("status")).toBeVisible();
  // L4: the self-service change is audited (no secrets in the summary).
  expect(await changeAudits(userId)).toBe(1);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(OLD_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email hoặc mật khẩu không đúng");
  await login(page, email, NEW_PW);
});

test("mật khẩu hiện tại sai: báo lỗi ngay dưới ô, không đổi mật khẩu", async ({ page }) => {
  const email = pwUser("wrong");
  const userId = await resetUser(email);
  await login(page, email, OLD_PW);
  await page.goto("/tai-khoan");
  await changePassword(page, "khong-phai-mat-khau", NEW_PW);
  const current = passwordForm(page).getByLabel("Mật khẩu hiện tại");
  await expect(current).toHaveAttribute("aria-invalid", "true");
  await expect(current).toHaveAccessibleDescription("Mật khẩu hiện tại không đúng");
  await expect(passwordForm(page).getByRole("status")).toHaveCount(0);

  await changePassword(page, OLD_PW, NEW_PW, `${NEW_PW}-khac`);
  await expect(passwordForm(page).getByLabel("Nhập lại mật khẩu mới")).toHaveAccessibleDescription("Mật khẩu xác nhận không khớp");

  // Mật khẩu cũ vẫn đúng, và lượt sai khi đổi mật khẩu không khóa đăng nhập (bộ đếm riêng theo user id).
  const fresh = await (await page.context().browser()!.newContext()).newPage();
  try { await login(fresh, email, OLD_PW); } finally { await fresh.context().close(); }
  expect(await changeAudits(userId)).toBe(0);
});

test("thẻ Đổi mật khẩu: không cuộn ngang, ô nhập ≥16px và vùng chạm ≥44px", async ({ page }) => {
  const email = pwUser("layout");
  await resetUser(email);
  await login(page, email, OLD_PW);
  await page.goto("/tai-khoan");
  const form = passwordForm(page);
  await expect(form).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const input of await form.locator("input[name]").all()) {
    const box = await input.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  }
  expect((await form.getByRole("button", { name: "Đổi mật khẩu" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await form.getByText("Hiện mật khẩu").boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(form.getByLabel("Mật khẩu hiện tại")).toHaveAttribute("autocomplete", "current-password");
  await expect(form.getByLabel("Mật khẩu mới", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(form.getByLabel("Mật khẩu mới", { exact: true })).toHaveAttribute("type", "password");
  await form.getByLabel("Hiện mật khẩu").check();
  await expect(form.getByLabel("Mật khẩu mới", { exact: true })).toHaveAttribute("type", "text");
});
