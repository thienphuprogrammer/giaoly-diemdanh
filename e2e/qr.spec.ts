import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classQ: string };
const LOGIN_PW = "e2e-password-1";
const sql = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });

// Mỗi project dùng một GLV riêng (xem global-setup): giới hạn tải bảng tra tính theo người dùng.
const scanner = () => (test.info().project.name === "tablet-768" ? "glv-a2@e2e.vn" : "glv-a@e2e.vn");
/** GLV thứ hai mỗi project cho các test mở màn quét nhiều lần (tải lại, đăng nhập lại), để không chạm giới hạn bảng tra. */
const reopener = () => (test.info().project.name === "tablet-768" ? "glv-a4@e2e.vn" : "glv-a3@e2e.vn");

async function login(page: Page, email = scanner()) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const tokenOf = async (name: string) => { const db = sql(); try { return (await db`select qr_token from students where full_name = ${name}`)[0].qr_token as string; } finally { await db.end(); } };
const feed = (page: Page, token: string) => page.evaluate((t) => (window as unknown as { __scanFeed: (p: string) => Promise<void> }).__scanFeed(`dd1.${t}`), token);
// global-setup có sẵn một dòng điểm danh của buổi trước (An vắng), nên chỉ đếm dòng của buổi hôm nay.
const todayMarks = (db: postgres.Sql) =>
  db`select st.full_name, a.status from attendance a join sessions se on se.id = a.session_id join students st on st.id = a.student_id where se.held_on = ${today()} order by st.full_name`;

const scanRegion = (page: Page) => page.getByRole("region", { name: "Quét thẻ QR" });

/** Chờ màn quét sẵn sàng: bảng tra đã về VÀ giao diện đã áp dụng nó (aria-busy=false), cầu nối test đã gắn. */
async function waitScannerReady(page: Page) {
  await expect(scanRegion(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.getByRole("radiogroup", { name: "Chế độ quét" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __scanFeed?: unknown }).__scanFeed)).toBe("function");
}

async function openScanner(page: Page, classId: string) {
  const roster = page.waitForResponse((r) => r.url().includes("/api/diem-danh/bang-tra"));
  await page.goto(`/lop/${classId}/diem-danh/${today()}/quet`);
  expect((await roster).status(), "tải bảng tra quét").toBe(200);
  await waitScannerReady(page);
}

/** Số lượt chưa lưu đang nằm trong localStorage (không đọc ra mã thẻ). */
const storedQueueSizes = (page: Page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.startsWith("diemdanh.scanQueue")).map((k) => (JSON.parse(localStorage.getItem(k) ?? "{}").events ?? []).length as number));
const QUET_API = "**/api/diem-danh/quet";

test.beforeEach(async () => {
  const db = sql();
  try { await db`delete from sessions where held_on = ${today()}`; await db`delete from attendance_scans`; } finally { await db.end(); }
});

test("in thẻ QR: mỗi em một thẻ có mã và nút cấp lại; trang danh sách không chứa mã", async ({ page }) => {
  await login(page);
  await page.goto(`/lop/${state().classA}/thieu-nhi`);
  expect(await page.content()).not.toContain("dd1.");
  await page.goto(`/lop/${state().classA}/thieu-nhi/the-qr`);
  await expect(page.getByRole("img", { name: /Mã QR của Nguyễn An/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cấp lại mã cho Nguyễn An/ })).toBeVisible();
});

test("quét liên tục: tên hiện ngay, đếm đã lưu, quét lại báo đã điểm danh", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Nguyễn An").first()).toBeVisible();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByText("Đã điểm danh").first()).toBeVisible();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
});

test("chế độ Đi muộn ghi Đi muộn và không hạ Có mặt", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn Bình"));
  await page.getByRole("radio", { name: "Đi muộn" }).click();
  await feed(page, await tokenOf("Nguyễn Chi"));
  await feed(page, await tokenOf("Nguyễn Bình")); // đã Có mặt: không đổi thành Đi muộn
  await expect(page.getByText("Đã điểm danh").first()).toBeVisible();
  // Đọc DB chỉ sau khi cả hai lượt đã được máy chủ xác nhận (trước đây đọc sớm có thể trượt lượt của Chi).
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 2")).toBeVisible();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đang gửi 0")).toBeVisible();
  const db = sql();
  try {
    const rows = await todayMarks(db);
    expect(rows.map((r) => [r.full_name, r.status])).toEqual([["Nguyễn Bình", "present"], ["Nguyễn Chi", "late"]]);
  } finally { await db.end(); }
});

test("thẻ lớp khác và thẻ mã lạ bị từ chối, không ghi gì", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Em Q01"));
  await expect(page.getByText("Thẻ không dùng được cho lớp này").first()).toBeVisible();
  const db = sql();
  try { expect(await todayMarks(db)).toHaveLength(0); } finally { await db.end(); }
});

test("mã lạ và mã sai định dạng bị từ chối, không ghi gì", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  const sent: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/diem-danh/quet")) sent.push(r.url()); });
  // Mã đúng định dạng nhưng không thuộc em nào, rồi các chuỗi sai định dạng: đều bị chặn ngay trên máy, không gửi đi.
  for (const raw of [`dd1.${"0".repeat(32)}`, `dd1.${"z".repeat(32)}`, "xin chào", "dd1.", "https://example.com/dd1.abc", ""]) {
    await page.evaluate((p) => (window as unknown as { __scanFeed: (p: string) => Promise<void> }).__scanFeed(p), raw);
    await expect(page.getByText("Thẻ không dùng được cho lớp này").first()).toBeVisible();
  }
  expect(sent).toEqual([]);
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đang gửi 0")).toBeVisible();
  const db = sql();
  try {
    expect(await todayMarks(db)).toHaveLength(0);
    expect(await db`select 1 from attendance_scans`).toHaveLength(0);
  } finally { await db.end(); }
});

test("màn quét toàn màn hình; chế độ quét được nhớ trong buổi", async ({ page }) => {
  await login(page, reopener());
  await openScanner(page, state().classA);
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Về danh sách lớp" })).toHaveCount(0);
  const xong = await page.getByRole("button", { name: "Xong" }).boundingBox();
  expect((xong?.y ?? 0) + (xong?.height ?? 0)).toBeGreaterThan((page.viewportSize()?.height ?? 0) - 120); // ở đáy, vùng ngón cái
  expect(xong?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("radio", { name: "Đi muộn" }).click();
  await page.reload();
  await waitScannerReady(page);
  await expect(page.getByRole("radio", { name: "Đi muộn" })).toHaveAttribute("aria-checked", "true");
});

test("lượt chưa lưu được giữ qua tải lại trang, gửi lại khi có mạng và chỉ ghi một lần", async ({ page, context }) => {
  page.on("dialog", (d) => void d.accept());
  await login(page, reopener());
  await openScanner(page, state().classA);
  // Lần gửi đầu tới được máy chủ (đã ghi) nhưng mất phản hồi; các lần sau coi như mất mạng.
  let reachedServer = false;
  await page.route(QUET_API, async (route) => {
    if (!reachedServer) { reachedServer = true; await route.fetch(); }
    await route.abort("internetdisconnected");
  });
  await feed(page, await tokenOf("Nguyễn An"));
  await expect.poll(() => reachedServer).toBe(true);
  await context.setOffline(true);
  await expect(page.getByText(/Mất mạng — các lượt quét được giữ trên máy/)).toBeVisible();
  await expect.poll(() => storedQueueSizes(page)).toEqual([1]);
  await context.setOffline(false); // "online" => gửi lại, vẫn bị chặn

  const historyBefore = await page.evaluate(() => history.length);
  await page.reload();
  await waitScannerReady(page);
  const row = page.getByRole("listitem").filter({ hasText: "Nguyễn An" });
  await expect(row.getByText(/Đang gửi|Chưa gửi được/)).toBeVisible();
  expect(await storedQueueSizes(page)).toEqual([1]);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore); // tải lại trên mục lính gác: không đặt chồng thêm mục

  await page.unroute(QUET_API);
  await context.setOffline(true);
  await context.setOffline(false); // có mạng lại => gửi lại ngay cùng mã lượt
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => storedQueueSizes(page)).toEqual([]); // đã lưu => xóa khỏi máy (cùng mã thẻ)
  const db = sql();
  try {
    expect((await todayMarks(db)).map((r) => [r.full_name, r.status])).toEqual([["Nguyễn An", "present"]]);
    expect(await db`select 1 from attendance_scans where kind = 'scan'`).toHaveLength(1);
  } finally { await db.end(); }
});

test("Back khi còn lượt chưa lưu thì hỏi lại; Xong về bảng bằng replace", async ({ page, context }) => {
  await login(page, reopener());
  await openScanner(page, state().classA);
  await page.route(QUET_API, (route) => route.abort("internetdisconnected"));
  await feed(page, await tokenOf("Nguyễn Bình"));
  await page.evaluate(() => history.back()); // nút Back của Android/trình duyệt
  const sheet = page.getByRole("dialog", { name: "Còn lượt chưa lưu" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/quet$/);
  await sheet.getByRole("button", { name: "Ở lại" }).click();
  await expect(sheet).toBeHidden();

  await page.unroute(QUET_API);
  await context.setOffline(true);
  await context.setOffline(false);
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Xong" }).click();
  await expect(page).toHaveURL(new RegExp(`/diem-danh/${today()}$`));
  await expect(page.getByRole("button", { name: /Nguyễn Bình: Có mặt/ })).toBeVisible(); // bảng có dữ liệu mới
  await page.goBack();
  await expect(page).not.toHaveURL(/\/quet$/); // Back không quay lại máy quét
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
});

test("phiên hết hạn khi đang quét: giữ lượt, báo cần đăng nhập lại, đăng nhập xong gửi tiếp", async ({ page, context }) => {
  page.on("dialog", (d) => void d.accept());
  await login(page, reopener());
  await openScanner(page, state().classA);
  await context.clearCookies();
  await feed(page, await tokenOf("Nguyễn Chi"));
  await expect(page.getByText(/Cần đăng nhập lại/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Nguyễn Chi" }).getByText("Chờ đăng nhập")).toBeVisible();
  expect(await storedQueueSizes(page)).toEqual([1]);

  await login(page, reopener());
  await openScanner(page, state().classA);
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => storedQueueSizes(page)).toEqual([]);
  const db = sql();
  try { expect((await todayMarks(db)).map((r) => r.full_name)).toEqual(["Nguyễn Chi"]); } finally { await db.end(); }
});

test("đăng xuất khi còn lượt quét chưa gửi thì hỏi trước và xóa hàng chờ khỏi máy", async ({ page }) => {
  await login(page, reopener());
  await openScanner(page, state().classA);
  await page.route(QUET_API, (route) => route.abort("internetdisconnected"));
  await feed(page, await tokenOf("Nguyễn Dũng"));
  await expect.poll(() => storedQueueSizes(page)).toEqual([1]);
  await page.goto("/tai-khoan");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  const sheet = page.getByRole("dialog", { name: "Còn lượt quét chưa gửi" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Vẫn đăng xuất" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await storedQueueSizes(page)).toEqual([]);
});

test("em đang vắng: hỏi xác nhận rồi mới đổi; hoàn tác trả về vắng", async ({ page }) => {
  const db = sql();
  try {
    const [session] = await db`insert into sessions (class_id, term_id, held_on) select ${state().classA}, id, ${today()} from terms limit 1 returning id`;
    await db`insert into attendance (session_id, student_id, status) select ${session.id}, id, 'absent_unexcused' from students where full_name = 'Nguyễn An'`;
  } finally { await db.end(); }
  await login(page);
  await openScanner(page, state().classA);
  await feed(page, await tokenOf("Nguyễn An"));
  await expect(page.getByRole("dialog", { name: /Chọn trạng thái cho Nguyễn An/ })).toBeVisible();
  await page.getByRole("button", { name: "Có mặt" }).click();
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
  await page.getByRole("button", { name: /Hoàn tác lượt của Nguyễn An/ }).click();
  await expect(page.getByText("Đã hoàn tác")).toBeVisible();
  const db2 = sql();
  try { expect((await todayMarks(db2)).map((r) => r.status)).toEqual(["absent_unexcused"]); } finally { await db2.end(); }
});

test("phản hồi thất lạc: gửi lại cùng mã lượt không tạo lượt thứ hai", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classA);
  let dropped = false;
  await page.route("**/api/diem-danh/quet", async (route) => {
    if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await feed(page, await tokenOf("Nguyễn Dũng"));
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible({ timeout: 10_000 });
  const db = sql();
  try {
    expect(await todayMarks(db)).toHaveLength(1);
    expect(await db`select 1 from attendance_scans where kind = 'scan'`).toHaveLength(1);
  } finally { await db.end(); }
});

test.describe("camera bị từ chối", () => {
  test.use({ permissions: [] });
  test("tìm bằng tên điểm danh được khi camera bị từ chối", async ({ page }) => {
    await login(page);
    await page.goto(`/lop/${state().classA}/diem-danh/${today()}/quet`);
    await expect(page.getByText(/Chưa cho phép dùng camera|Không mở được camera/)).toBeVisible();
    await page.getByRole("button", { name: "Tìm bằng tên" }).first().click();
    await page.getByLabel("Tìm tên").fill("nguyen chi");
    await page.getByRole("button", { name: /Nguyễn Chi/ }).click();
    await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 1")).toBeVisible();
  });
});

test("30 thẻ liên tục đều được lưu", async ({ page }) => {
  await login(page);
  await openScanner(page, state().classQ);
  const db = sql();
  let tokens: string[];
  try { tokens = (await db`select qr_token from students where full_name like 'Em Q%' order by full_name`).map((r) => r.qr_token as string); } finally { await db.end(); }
  const t0 = Date.now();
  for (const t of tokens) await feed(page, t);
  await expect(page.getByLabel("Tổng kết lượt quét").getByText("Đã lưu 30")).toBeVisible({ timeout: 20_000 });
  console.log(`30 lượt lưu xong sau ${Date.now() - t0}ms`);
});

test("người chỉ đọc không mở được màn quét hay trang in thẻ", async ({ page }) => {
  await login(page, "head-a@e2e.vn");
  for (const path of [`/lop/${state().classA}/diem-danh/${today()}/quet`, `/lop/${state().classA}/thieu-nhi/the-qr`]) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});
