import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classL: string };
const LOGIN_PW = "e2e-password-1";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const db = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
const pushUser = () => `glv-push-${test.info().project.name}@e2e.vn`;

async function subscriptionsOf(email: string): Promise<string[]> {
  const sql = db();
  try {
    const rows = await sql<{ endpoint: string }[]>`select p.endpoint from push_subscriptions p join users u on u.id = p.user_id where u.email = ${email}`;
    return rows.map((r) => r.endpoint);
  } finally {
    await sql.end();
  }
}

test.beforeEach(async () => {
  const sql = db();
  try {
    await sql`delete from push_subscriptions where user_id in (select id from users where email like 'glv-push-%')`;
    await sql`update classes set meets_on = null, meets_at = null where id = ${state().classL}`;
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

/**
 * Chromium headless không tới được dịch vụ push thật và luôn báo `Notification.permission = "denied"`: giả lập quyền
 * (bắt đầu từ `initial`, bấm xin quyền thì thành "granted") và PushManager (đăng ký đúng dạng: endpoint FCM, khoá 65/16
 * byte ngẫu nhiên). Đếm số lần xin quyền để kiểm "chỉ xin khi bấm". Service worker `/sw.js` vẫn được đăng ký thật.
 */
async function fakePush(page: Page, initial: NotificationPermission = "default") {
  await page.addInitScript((start) => {
    const w = window as unknown as { __permissionAsks: number };
    w.__permissionAsks = 0;
    let permission: NotificationPermission = start;
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    Notification.requestPermission = (async () => {
      w.__permissionAsks += 1;
      permission = "granted";
      return permission;
    }) as typeof Notification.requestPermission;
    const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    let current: PushSubscription | null = null;
    PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
      const key = rand(65);
      key[0] = 4;
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${b64(rand(12))}`;
      const serverKey = options?.applicationServerKey as Uint8Array;
      const json = { endpoint, expirationTime: null, keys: { p256dh: b64(key), auth: b64(rand(16)) } };
      current = {
        endpoint, expirationTime: null, options: { applicationServerKey: serverKey.slice().buffer, userVisibleOnly: true },
        toJSON: () => json, unsubscribe: async () => { current = null; return true; }, getKey: () => null,
      } as unknown as PushSubscription;
      return current;
    };
    PushManager.prototype.getSubscription = async function () { return current; };
  }, initial);
}

const card = (page: Page) => page.getByRole("region", { name: "Thông báo" });

test("/sw.js: công khai (không chuyển về đăng nhập), là JavaScript, không cache", async ({ request }) => {
  test.skip(test.info().project.name !== "phone-375", "chỉ chạy ở phone-375");
  const res = await request.get("/sw.js", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^application\/javascript/);
  expect(res.headers()["cache-control"]).toContain("no-cache");
  const body = await res.text();
  expect(body).toContain("addEventListener(\"push\"");
  expect(body).not.toMatch(/addEventListener\("fetch"/);
});

test("Tài khoản: không xin quyền khi mở; bấm Bật thông báo -> Đang bật và lưu đăng ký; Tắt -> xoá", async ({ page }) => {
  await fakePush(page);
  await login(page, pushUser());
  await page.goto("/tai-khoan");
  await expect(card(page)).toHaveAttribute("data-push-state", "off");
  await expect(card(page).getByText("Chưa bật")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks)).toBe(0);
  expect(await page.evaluate(() => Notification.permission)).toBe("default");

  const enable = card(page).getByRole("button", { name: "Bật thông báo" });
  const box = await enable.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await enable.click();
  await expect(card(page)).toHaveAttribute("data-push-state", "on");
  await expect(card(page).getByText("Đang bật")).toBeVisible();
  await expect(card(page).getByRole("status")).toContainText("Đã bật thông báo");
  expect(await page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks)).toBe(1);
  await expect.poll(() => subscriptionsOf(pushUser())).toHaveLength(1);
  expect((await subscriptionsOf(pushUser()))[0]).toMatch(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\/e2e-/);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/"))?.active?.scriptURL)).toMatch(/\/sw\.js$/);
  await expect(card(page).getByRole("button", { name: "Gửi thử" })).toBeVisible();

  await card(page).getByRole("button", { name: "Tắt thông báo" }).click();
  await expect(card(page)).toHaveAttribute("data-push-state", "off");
  await expect.poll(() => subscriptionsOf(pushUser())).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test("Tài khoản: quyền đã cấp nhưng mất đăng ký -> tự đăng ký lại lặng lẽ khi mở trang", async ({ page }) => {
  await fakePush(page, "granted");
  await login(page, pushUser());
  await page.goto("/tai-khoan");
  await expect(card(page)).toHaveAttribute("data-push-state", "on");
  await expect.poll(() => subscriptionsOf(pushUser())).toHaveLength(1);
  expect(await page.evaluate(() => (window as unknown as { __permissionAsks: number }).__permissionAsks)).toBe(0);
});

test("Tài khoản: quyền bị chặn -> hướng dẫn mở Cài đặt, không có nút bật", async ({ page }) => {
  await fakePush(page, "denied");
  await login(page, pushUser());
  await page.goto("/tai-khoan");
  await expect(card(page)).toHaveAttribute("data-push-state", "blocked");
  await expect(card(page).getByText("Bị chặn trong cài đặt")).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Bật thông báo" })).toHaveCount(0);
});

test("Tài khoản trên iPhone (tab Safari, chưa cài) -> hướng dẫn Thêm vào Màn hình chính", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone-375", "chỉ chạy ở phone-375");
  const context = await browser.newContext({ userAgent: IPHONE_UA, viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await login(page, pushUser());
    await page.goto("/tai-khoan");
    await expect(card(page)).toHaveAttribute("data-push-state", "ios_install");
    await expect(card(page).getByText(/Thêm vào Màn hình chính/).first()).toBeVisible();
    await expect(card(page).getByRole("button", { name: "Bật thông báo" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Lịch học: GLV đặt Chủ nhật 08:00 rồi xoá; trưởng khối cũng sửa được", async ({ page }) => {
  await login(page, "glv-l@e2e.vn");
  await page.goto(`/lop/${state().classL}`);
  await page.getByText("Lịch học: chưa đặt").click();
  await page.getByRole("combobox", { name: /^Thứ/ }).selectOption({ label: "Chủ nhật" });
  await page.getByLabel("Giờ bắt đầu").fill("08:00");
  const save = page.getByRole("button", { name: "Lưu lịch" });
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.click();
  await expect(page.getByText("Đã lưu lịch học")).toBeVisible();
  await expect(page.getByText("Lịch học: Chủ nhật 08:00")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Lịch học: Chủ nhật 08:00")).toBeVisible();

  await page.getByText("Lịch học: Chủ nhật 08:00").click();
  await page.getByRole("button", { name: "Xoá lịch" }).click();
  await expect(page.getByText("Lịch học: chưa đặt")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.context().clearCookies();
  await login(page, "head-l@e2e.vn");
  await page.goto(`/lop/${state().classL}`);
  await page.getByText("Lịch học: chưa đặt").click();
  await page.getByRole("combobox", { name: /^Thứ/ }).selectOption({ label: "Thứ bảy" });
  await page.getByLabel("Giờ bắt đầu").fill("17:30");
  await page.getByRole("button", { name: "Lưu lịch" }).click();
  await expect(page.getByText("Lịch học: Thứ bảy 17:30")).toBeVisible();
});
