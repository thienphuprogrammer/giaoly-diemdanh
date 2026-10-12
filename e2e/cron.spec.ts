import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";

/**
 * Route nhắc việc `/api/cron/nhac-viec` qua HTTP thật (dev server của E2E, PUSH_DRY_RUN=1 nên không có yêu cầu nào đi ra
 * dịch vụ push). Bí mật do playwright.config.ts sinh lúc chạy. Nhánh 503 (CRON_SECRET thiếu/ngắn) được test đơn vị.
 */
const ROUTE = "/api/cron/nhac-viec";
const LOGIN_PW = "e2e-password-1";
const token = () => process.env.E2E_CRON_TOKEN ?? "";
const bearer = () => ({ authorization: `Bearer ${token()}` });
const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classL: string; kidMassWarn: string };
const db = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });

async function withDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = db();
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

/** Đăng ký giả hợp lệ về dạng (endpoint FCM, khoá ngẫu nhiên): PUSH_DRY_RUN khiến lần gửi không ra mạng. */
const addDevice = (email: string) => withDb((sql) => sql`
  insert into push_subscriptions (user_id, endpoint, p256dh, auth)
  select id, ${`https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(8).toString("hex")}`},
    ${Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url")}, ${randomBytes(16).toString("base64url")}
  from users where email = ${email}`);

const logRows = (email: string, kind: string) => withDb((sql) => sql<{ target_key: string }[]>`
  select n.target_key from notification_log n join users u on u.id = n.user_id where u.email = ${email} and n.kind = ${kind}`);

/** Giờ Việt Nam (+07, không có giờ mùa hè). */
function vnNow() {
  const t = new Date(Date.now() + 7 * 3600_000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

test.beforeEach(async () => {
  await withDb(async (sql) => {
    await sql`delete from push_subscriptions`;
    await sql`delete from notification_log where kind in ('class_reminder', 'absence_threshold', 'mass_threshold')`;
    await sql`update classes set meets_on = null, meets_at = null where id = ${state().classL}`;
  });
});

test.afterAll(async () => {
  await withDb(async (sql) => {
    await sql`delete from push_subscriptions where endpoint like 'https://fcm.googleapis.com/fcm/send/e2e-%'`;
    await sql`update classes set meets_on = null, meets_at = null where id = ${state().classL}`;
  });
});

test("thiếu hoặc sai bí mật: 401, không cache, không chạy", async ({ request }) => {
  expect(token().length).toBeGreaterThanOrEqual(32);
  for (const headers of [{}, { authorization: `Bearer ${randomBytes(36).toString("base64url")}` }, { authorization: token() }] as Record<string, string>[]) {
    const get = await request.get(ROUTE, { headers });
    expect(get.status()).toBe(401);
    expect(get.headers()["cache-control"]).toBe("no-store");
    expect(await get.text()).not.toContain(token());
  }
  expect((await request.post(ROUTE)).status()).toBe(401);
});

test("không ai có thiết bị: chạy xong, không gửi, có mục bỏ qua, chỉ trả số đếm", async ({ request }) => {
  const res = await request.get(ROUTE, { headers: bearer() });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = await res.json() as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["complete", "failed", "pruned", "sent", "skipped"]);
  expect(body).toMatchObject({ sent: 0, failed: 0, complete: true });
  expect(body.skipped as number).toBeGreaterThan(0); // trưởng khối A/C/E có em chạm ngưỡng nhưng chưa bật thông báo
  expect(await logRows("head-c@e2e.vn", "mass_threshold")).toEqual([]);
});

test("trưởng khối có thiết bị: ghi nhật ký cho em chạm ngưỡng đi lễ, gửi một lần, gọi lại không gửi trùng (POST)", async ({ request }) => {
  await addDevice("head-c@e2e.vn");
  const first = await request.post(ROUTE, { headers: bearer() });
  expect(first.status()).toBe(200);
  const body = await first.json() as { sent: number; failed: number };
  expect(body.sent).toBeGreaterThanOrEqual(1);
  expect(body.failed).toBe(0);
  const rows = await logRows("head-c@e2e.vn", "mass_threshold");
  expect(rows.map((r) => r.target_key.split(":")[0])).toContain(state().kidMassWarn);

  const again = await request.get(ROUTE, { headers: bearer() });
  expect(again.status()).toBe(200);
  expect((await again.json() as { sent: number }).sent).toBe(0);
  expect(await logRows("head-c@e2e.vn", "mass_threshold")).toHaveLength(rows.length);
});

test("nhắc GLV khi lớp đã qua giờ học 30 phút mà chưa điểm danh", async ({ request }) => {
  const now = vnNow();
  test.skip(now.minutes < 46, "cần giờ học hôm nay trước hiện tại 45 phút (chạy gần nửa đêm giờ Việt Nam)");
  const start = now.minutes - 45;
  const meetsAt = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
  await withDb((sql) => sql`update classes set meets_on = ${now.weekday}, meets_at = ${meetsAt} where id = ${state().classL}`);
  await addDevice("glv-l@e2e.vn");

  const res = await request.get(ROUTE, { headers: bearer() });
  expect(res.status()).toBe(200);
  expect((await res.json() as { sent: number }).sent).toBeGreaterThanOrEqual(1);
  expect((await logRows("glv-l@e2e.vn", "class_reminder")).map((r) => r.target_key)).toEqual([`${state().classL}:${now.date}`]);

  await request.get(ROUTE, { headers: bearer() });
  expect(await logRows("glv-l@e2e.vn", "class_reminder")).toHaveLength(1);
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

test("trang Tài khoản giải thích nhắc việc", async ({ page }) => {
  await login(page, "glv-l@e2e.vn");
  await page.goto("/tai-khoan");
  const help = page.getByTestId("reminder-help");
  await expect(help).toContainText("Nhắc việc");
  await expect(help).toContainText("không ghi tên các em");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
