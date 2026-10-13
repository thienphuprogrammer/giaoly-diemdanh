import { readFileSync } from "node:fs";
import { expect, test, type Page } from "./fixtures";
import postgres from "postgres";
import { massSundayFor } from "../src/lib/attendance/mass-week";

/**
 * Đi lễ "cách 2": quét thẻ tại nhà thờ (buổi `mass` của Chúa nhật). Mỗi project một GLV riêng của lớp A
 * (bảng tra giới hạn 30 lần/phút mỗi người).
 */
const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string };
const LOGIN_PW = "e2e-password-1";
const sql = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
const massUser = () => (test.info().project.name === "tablet-768" ? "glv-m2@e2e.vn" : "glv-m1@e2e.vn");

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const sunday = () => massSundayFor(today());
const sundayTitle = () => `Điểm danh đi lễ — Chúa nhật ${sunday().slice(8, 10)}/${sunday().slice(5, 7)}`;
const massHref = () => `/lop/${state().classA}/di-le/${sunday()}/quet`;
const QUET_API = "**/api/diem-danh/quet";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(massUser());
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
}

const tokenOf = async (name: string) => { const db = sql(); try { return (await db`select qr_token from students where full_name = ${name}`)[0].qr_token as string; } finally { await db.end(); } };
const feed = (page: Page, token: string) => page.evaluate((t) => (window as unknown as { __scanFeed: (p: string) => Promise<void> }).__scanFeed(`dd1.${t}`), token);
const scanRegion = (page: Page) => page.getByRole("region", { name: "Quét thẻ QR" });
const summary = (page: Page) => page.getByLabel("Tổng kết lượt quét");
const storedQueueSizes = (page: Page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith("diemdanh.scanQueue")).map((k) => (JSON.parse(localStorage.getItem(k) ?? "{}").events ?? []).length as number));

/** Máy quét đi lễ sẵn sàng: bảng tra đã áp dụng, cầu nối test đã gắn. Không có công tắc chế độ để chờ. */
async function waitMassScannerReady(page: Page) {
  await expect(scanRegion(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("heading", { name: sundayTitle() })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __scanFeed?: unknown }).__scanFeed)).toBe("function");
}

async function openMassScanner(page: Page) {
  const roster = page.waitForResponse((r) => r.url().includes("/api/diem-danh/bang-tra"));
  await page.goto(massHref());
  expect((await roster).status(), "tải bảng tra quét").toBe(200);
  await waitMassScannerReady(page);
}

/** Dòng điểm danh của lớp A theo loại buổi (mass: chỉ Chúa nhật của tuần). */
const massMarks = (db: postgres.Sql) =>
  db`select st.full_name, a.status from attendance a join sessions se on se.id = a.session_id join students st on st.id = a.student_id
     where se.class_id = ${state().classA} and se.kind = 'mass' and se.held_on = ${sunday()} order by st.full_name`;
const classMarkCount = async (db: postgres.Sql) =>
  (await db`select count(*)::int as n from attendance a join sessions se on se.id = a.session_id where se.class_id = ${state().classA} and se.kind = 'class'`)[0].n as number;
const classSessionsState = (db: postgres.Sql) =>
  db`select held_on, cancelled from sessions where class_id = ${state().classA} and kind = 'class' order by held_on`;

test.beforeEach(async () => {
  const db = sql();
  try {
    const ids = await db`select id from sessions where class_id = ${state().classA} and kind = 'mass'`;
    if (ids.length) {
      await db`delete from attendance_scans where session_id in ${db(ids.map((r) => r.id as string))}`;
      await db`delete from sessions where id in ${db(ids.map((r) => r.id as string))}`;
    }
  } finally { await db.end(); }
});

test("đi lễ tại nhà thờ: từ trang lớp quét 2 em, ghi vào buổi đi lễ; không có Đi muộn; cuối buổi không có Đánh vắng", async ({ page }) => {
  const db = sql();
  const classBefore = await classMarkCount(db).finally(() => db.end());
  await login(page);
  await page.goto(`/lop/${state().classA}`);
  const roster = page.waitForResponse((r) => r.url().includes("/api/diem-danh/bang-tra"));
  await page.getByRole("link", { name: "Điểm danh đi lễ" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}/di-le/${sunday()}/quet$`));
  expect((await roster).status()).toBe(200);
  await waitMassScannerReady(page);

  await expect(page.getByRole("radiogroup", { name: "Chế độ quét" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Đi muộn" })).toHaveCount(0);
  await expect(page.getByText("Quét thẻ = Đi lễ")).toBeVisible();

  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Đã ghi Đi lễ").first()).toBeVisible();
  await feed(page, await tokenOf("Nguyễn Bình"));
  await expect(summary(page).getByText("Đã lưu 2")).toBeVisible();
  await expect(summary(page).getByText("Đang gửi 0")).toBeVisible();
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Đã ghi đi lễ").first()).toBeVisible();

  const db2 = sql();
  try {
    expect((await massMarks(db2)).map((r) => [r.full_name, r.status])).toEqual([["Nguyễn An", "present"], ["Nguyễn Bình", "present"]]);
    expect(await classMarkCount(db2)).toBe(classBefore);
    const scans = await db2`select se.kind from attendance_scans s join sessions se on se.id = s.session_id where s.result = 'applied' and s.kind = 'scan' and se.class_id = ${state().classA}`;
    expect(scans.map((r) => r.kind)).toEqual(["mass", "mass"]);
  } finally { await db2.end(); }

  await page.getByRole("button", { name: "Kiểm tra cuối buổi" }).click();
  const sheet = page.getByRole("dialog", { name: "Kiểm tra cuối buổi" });
  await expect(sheet.getByRole("heading", { name: "Em chưa quét (2)" })).toBeVisible();
  await expect(sheet.getByText(/Em chưa quét sẽ được tính là chưa đi lễ trong tuần đã ghi\./)).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Đánh vắng/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Về trang lớp" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}$`));
});

test("đi lễ: lượt chưa lưu được giữ qua tải lại trang, offline→online chỉ gửi đúng một lần", async ({ page, context }) => {
  page.on("dialog", (d) => void d.accept());
  await login(page);
  await openMassScanner(page);
  let reachedServer = false;
  await page.route(QUET_API, async (route) => {
    if (!reachedServer) { reachedServer = true; await route.fetch(); } // tới máy chủ (đã ghi) nhưng mất phản hồi
    await route.abort("internetdisconnected");
  });
  await feed(page, await tokenOf("Nguyễn Chi"));
  await expect.poll(() => reachedServer).toBe(true);
  await context.setOffline(true);
  await expect.poll(() => storedQueueSizes(page)).toEqual([1]);
  await context.setOffline(false);

  await page.reload();
  await waitMassScannerReady(page);
  await expect(page.getByRole("listitem").filter({ hasText: "Nguyễn Chi" }).getByText(/Đang gửi|Chưa gửi được/)).toBeVisible();
  expect(await storedQueueSizes(page)).toEqual([1]);

  await page.unroute(QUET_API);
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(summary(page).getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => storedQueueSizes(page)).toEqual([]);
  const db = sql();
  try {
    expect((await massMarks(db)).map((r) => [r.full_name, r.status])).toEqual([["Nguyễn Chi", "present"]]);
    const scans = await db`select 1 from attendance_scans s join sessions se on se.id = s.session_id where s.kind = 'scan' and se.kind = 'mass' and se.class_id = ${state().classA}`;
    expect(scans).toHaveLength(1);
  } finally { await db.end(); }
});

test("đi lễ: em đang ghi không đi lễ không phép thì hỏi xác nhận, chỉ có Có đi lễ", async ({ page }) => {
  const db = sql();
  try {
    const [session] = await db`insert into sessions (class_id, term_id, held_on, kind) select ${state().classA}, id, ${sunday()}, 'mass' from terms limit 1 returning id`;
    await db`insert into attendance (session_id, student_id, status) select ${session.id}, id, 'absent_unexcused' from students where full_name = 'Nguyễn Dũng'`;
  } finally { await db.end(); }
  await login(page);
  await openMassScanner(page);
  await feed(page, await tokenOf("Nguyễn Dũng"));
  const dialog = page.getByRole("dialog", { name: /Chọn trạng thái cho Nguyễn Dũng/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Không đi lễ không phép")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Đi muộn" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Có đi lễ" }).click();
  await expect(summary(page).getByText("Đã lưu 1")).toBeVisible();
  const db2 = sql();
  try { expect((await massMarks(db2)).map((r) => [r.full_name, r.status])).toEqual([["Nguyễn Dũng", "present"]]); } finally { await db2.end(); }
});

test("đi lễ: tuần này không có lễ thì mọi lượt quét bị từ chối; buổi học không bị đánh nghỉ; mở lại thì quét được", async ({ page }) => {
  await login(page);
  await openMassScanner(page);
  const sent: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/diem-danh/quet")) sent.push(r.url()); });
  await page.getByRole("button", { name: "Tuần này không có lễ" }).click();
  await page.getByRole("dialog", { name: "Tuần này không có lễ?" }).getByRole("button", { name: "Không có lễ" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tuần này không có lễ — không ghi đi lễ" })).toBeVisible();

  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Tuần này không có lễ — không ghi đi lễ").first()).toBeVisible();
  await expect(summary(page).getByText("Đã lưu 0")).toBeVisible();
  expect(sent).toEqual([]);
  const db = sql();
  try {
    expect(await massMarks(db)).toHaveLength(0);
    expect((await db`select cancelled from sessions where class_id = ${state().classA} and kind = 'mass'`).map((r) => r.cancelled)).toEqual([true]);
    expect((await classSessionsState(db)).every((r) => r.cancelled === false)).toBe(true);
  } finally { await db.end(); }

  // Tải lại vẫn thấy tuần đã huỷ (đọc từ máy chủ); mở lại thì quét được.
  await page.reload();
  await expect(scanRegion(page)).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Mở lại tuần đi lễ" }).click();
  await expect(page.getByRole("button", { name: "Tuần này không có lễ" })).toBeVisible();
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(summary(page).getByText("Đã lưu 1")).toBeVisible();
  const db2 = sql();
  try { expect((await massMarks(db2)).map((r) => [r.full_name, r.status])).toEqual([["Nguyễn An", "present"]]); } finally { await db2.end(); }
});

test("đi lễ: từ phần Đi lễ của bảng điểm danh mở Quét tại nhà thờ; Xong lùi về bảng", async ({ page }) => {
  await login(page);
  const boardHref = `/lop/${state().classA}/diem-danh/${today()}`;
  await page.goto(boardHref);
  await page.getByRole("button", { name: /Đi lễ Chúa nhật/ }).click();
  const roster = page.waitForResponse((r) => r.url().includes("/api/diem-danh/bang-tra"));
  await page.getByRole("link", { name: "Quét tại nhà thờ" }).click();
  await expect(page).toHaveURL(new RegExp(`/di-le/${sunday()}/quet\\?from=board$`));
  expect((await roster).status()).toBe(200);
  await waitMassScannerReady(page);
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page).toHaveURL(new RegExp(`${boardHref}$`));
});

test("đi lễ: trên bảng điểm danh, 'Tuần này không có lễ' chỉ huỷ tuần đi lễ, không đụng Buổi nghỉ lễ; mở lại được", async ({ page }) => {
  await login(page);
  await page.goto(`/lop/${state().classA}/diem-danh/${today()}`);
  await page.getByRole("button", { name: /Đi lễ Chúa nhật/ }).click();
  const section = page.getByRole("region", { name: "Đi lễ Chúa nhật" });
  await section.getByRole("button", { name: "Tuần này không có lễ" }).click();
  await expect(section.getByText("Thánh lễ tuần này đã được đánh dấu nghỉ")).toBeVisible();
  await expect(section.getByRole("button", { name: "Cả lớp đi lễ" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Buổi nghỉ lễ/ })).not.toBeChecked();
  const db = sql();
  try {
    expect((await db`select cancelled from sessions where class_id = ${state().classA} and kind = 'mass' and held_on = ${sunday()}`).map((r) => r.cancelled)).toEqual([true]);
    expect((await classSessionsState(db)).every((r) => r.cancelled === false)).toBe(true);
  } finally { await db.end(); }
  await section.getByRole("button", { name: "Mở lại tuần đi lễ" }).click();
  await expect(section.getByRole("button", { name: "Cả lớp đi lễ" })).toBeVisible();
});

test("đi lễ: ngày không phải Chúa nhật (không chọn thủ công) báo lỗi kèm lối về trang lớp, không tạo buổi", async ({ page }) => {
  await login(page);
  const saturday = new Date(Date.parse(`${sunday()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await page.goto(`/lop/${state().classA}/di-le/${saturday}/quet`);
  await expect(page.getByRole("alert").filter({ hasText: "Buổi đi lễ phải vào Chúa nhật" })).toBeVisible();
  await page.getByRole("link", { name: "Về trang lớp" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}$`));
  const db = sql();
  try { expect(await db`select 1 from sessions where class_id = ${state().classA} and kind = 'mass'`).toHaveLength(0); } finally { await db.end(); }
});
