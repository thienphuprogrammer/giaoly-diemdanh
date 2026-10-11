import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classQ: string };
const LOGIN_PW = "e2e-password-1";
const sql = () => postgres(process.env.E2E_DATABASE_URL!, { max: 1 });

// Mỗi project dùng một GLV riêng (xem global-setup): giới hạn tải bảng tra tính theo người dùng.
const scanner = () => (test.info().project.name === "tablet-768" ? "glv-a2@e2e.vn" : "glv-a@e2e.vn");

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

async function openScanner(page: Page, classId: string) {
  // Màn quét bỏ qua lượt quét tới trước khi tải xong bảng tra ("Đang tải danh sách lớp…"), nên chờ bảng tra trước.
  const roster = page.waitForResponse((r) => r.url().includes("/api/diem-danh/bang-tra"));
  await page.goto(`/lop/${classId}/diem-danh/${today()}/quet`);
  const res = await roster;
  expect(res.status(), "tải bảng tra quét").toBe(200);
  await res.finished();
  await expect(page.getByRole("radiogroup", { name: "Chế độ quét" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { __scanFeed?: unknown }).__scanFeed)).toBe("function");
}

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
