import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./fixtures";
import { SignJWT } from "jose";
import postgres from "postgres";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classC: string };
const LOGIN_PW = "e2e-password-1";
const E2E_SIGNING_KEY = "e".repeat(40); // khớp AUTH_SECRET của webServer trong playwright.config.ts
const DAY_S = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

async function fillLogin(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await fillLogin(page, email);
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

const userId = async (email: string) => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return (await sql`select id from users where email = ${email}`)[0].id as string; } finally { await sql.end(); }
};
const signToken = (uid: string, exp: number) =>
  new SignJWT({ userId: uid }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(exp)
    .sign(new TextEncoder().encode(E2E_SIGNING_KEY));
const sessionCookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === "session");

test.beforeEach(async () => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { await sql`delete from sessions where held_on = ${todayInVietnam()}`; } finally { await sql.end(); }
});

test("mở trang sâu khi chưa đăng nhập: đăng nhập xong quay về đúng trang (kể cả query)", async ({ page }) => {
  const target = `/lop/${state().classA}/thong-ke?ky=hien-tai`;
  await page.goto(target);
  await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === target);
  await fillLogin(page, "glv-a@e2e.vn");
  await expect(page).toHaveURL((u) => `${u.pathname}${u.search}` === target);
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeHidden();
});

for (const [label, next] of [
  ["//host khác", "//evil.example/lop"],
  ["URL tuyệt đối", "https://evil.example"],
  ["/\\host khác", "/\\evil.example"],
  ["mã hóa //", "/%2F%2Fevil.example"],
  ["chính trang /login", "/login"],
] as const) {
  test(`next không an toàn (${label}) thì về trang chủ`, async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await fillLogin(page, "glv-a@e2e.vn");
    await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL ?? "http://localhost:3100").host);
  });
}

test("phiên trượt: cookie còn dưới 3 ngày được cấp lại 30 ngày; phiên hết hạn bị chuyển về /login có next", async ({ page, baseURL }) => {
  const uid = await userId("glv-a@e2e.vn");
  const nearExpiry = await signToken(uid, nowS() + 2 * DAY_S);
  await page.context().addCookies([{ name: "session", value: nearExpiry, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
  const renewed = await sessionCookie(page);
  expect(renewed?.value).not.toBe(nearExpiry);
  expect(renewed?.httpOnly).toBe(true);
  expect(renewed?.sameSite).toBe("Lax");
  expect(renewed!.expires - nowS()).toBeGreaterThan(29 * DAY_S);
  expect(renewed!.expires - nowS()).toBeLessThanOrEqual(30 * DAY_S + 60);

  // Còn nhiều ngày: không cấp lại.
  await page.goto(`/lop/${state().classA}`);
  expect((await sessionCookie(page))?.value).toBe(renewed?.value);

  // Hết hạn: không gia hạn, chuyển về /login kèm next, cookie bị xóa.
  const expired = await signToken(uid, nowS() - 60);
  await page.context().addCookies([{ name: "session", value: expired, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(`/lop/${state().classA}`);
  await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === `/lop/${state().classA}`);
  expect(await sessionCookie(page)).toBeUndefined();
});

test("thẻ lớp: GLV có Điểm danh hôm nay + Quét QR; trưởng khối chỉ đọc chỉ có xem và thống kê", async ({ page }) => {
  await login(page, "head-a@e2e.vn");
  const cardOf = (name: RegExp) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name }) });
  const readOnly = cardOf(/Lớp A/);
  await expect(readOnly.getByRole("link", { name: "Xem buổi hôm nay" })).toBeVisible();
  await expect(readOnly.getByRole("link", { name: "Thống kê" })).toBeVisible();
  await expect(readOnly.getByRole("link", { name: "Quét QR" })).toHaveCount(0);
  await expect(readOnly.getByRole("link", { name: "Điểm danh hôm nay" })).toHaveCount(0);
  const writable = cardOf(/Lớp C/);
  await expect(writable.getByRole("link", { name: "Điểm danh hôm nay" })).toBeVisible();
  await expect(writable.getByRole("link", { name: "Quét QR" })).toBeVisible();

  // Vùng chạm ≥ 44px, không cuộn ngang.
  for (const link of await page.getByRole("listitem").getByRole("link", { name: /Điểm danh hôm nay|Quét QR|Xem buổi hôm nay|Thống kê/ }).all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Xem buổi hôm nay của lớp chỉ đọc không mở buổi mới.
  await readOnly.getByRole("link", { name: "Xem buổi hôm nay" }).click();
  await expect(page.getByText(/Chưa có buổi điểm danh ngày/)).toBeVisible();

  await page.goto("/");
  await cardOf(/Lớp C/).getByRole("link", { name: "Quét QR" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classC}/diem-danh/${todayInVietnam()}/quet$`));
  await expect(page.getByRole("region", { name: "Quét thẻ QR" })).toBeVisible();
});

test("token hợp lệ của tài khoản không còn tồn tại: vẫn bị từ chối, requireUser chuyển về /login có next", async ({ page, baseURL }) => {
  const ghost = await signToken("00000000-0000-4000-8000-000000000000", nowS() + 2 * DAY_S); // sắp hết hạn: proxy sẽ cấp lại
  await page.context().addCookies([{ name: "session", value: ghost, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
  const target = `/lop/${state().classA}/thong-ke`;
  await page.goto(target);
  await expect(page).toHaveURL((u) => u.pathname === "/login" && u.searchParams.get("next") === target);
  await fillLogin(page, "glv-a@e2e.vn");
  await expect(page).toHaveURL((u) => u.pathname === target);
});
