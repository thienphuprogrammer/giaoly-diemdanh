import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classN: string; glvN: string };
const LOGIN_PW = "e2e-password-1";

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return await fn(sql); } finally { await sql.end(); }
}

// Cả hai project dùng chung dữ liệu: dọn nhật ký/buổi của lớp A (hôm nay) và lớp N trước mỗi test.
test.beforeEach(async () => {
  await withSql(async (sql) => {
    const { classA, classN } = state();
    await sql`delete from audit_events where class_id in (${classA}, ${classN})`;
    await sql`delete from sessions where class_id = ${classN}`;
    await sql`delete from sessions where class_id = ${classA} and held_on = ${todayInVietnam()}`;
  });
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** Gieo `n` dòng "thêm em" cách nhau 1 phút, mới nhất trước, kèm tên dễ đếm. */
async function seedStudentEvents(n: number) {
  await withSql(async (sql) => {
    const { classN, glvN } = state();
    for (let i = 1; i <= n; i++) {
      await sql`insert into audit_events (at, actor_id, class_id, entity, action, summary)
        values (now() - make_interval(mins => ${i}), ${glvN}, ${classN}, 'student', 'student.create', ${sql.json({ studentName: `Em Nhật ${String(i).padStart(3, "0")}` })})`;
    }
  });
}

test("sửa điểm danh rồi thấy dòng nhật ký đúng người, đúng giờ", async ({ page }) => {
  const before = Date.now();
  await login(page, "glv-a@e2e.vn");
  await page.goto(`/lop/${state().classA}/diem-danh/${todayInVietnam()}`);
  await page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ }).click();
  await expect(page.getByRole("button", { name: /Nguyễn An: Có mặt/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await page.getByRole("button", { name: /Nguyễn An: Có mặt/ }).click();
  await expect(page.getByRole("button", { name: /Nguyễn An: Vắng không phép/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();

  await page.getByRole("navigation", { name: "Điều hướng lớp" }).getByRole("link", { name: "Nhật ký" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}/nhat-ky$`));
  await expect(page.getByRole("heading", { name: "Nhật ký thay đổi" })).toBeVisible();
  const items = page.getByRole("listitem").filter({ hasText: "GLV A" }).filter({ hasText: "Nguyễn An" });
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("GLV A đổi Nguyễn An: Có mặt → Vắng không phép");
  await expect(items.last()).toContainText("GLV A điểm danh Nguyễn An: Có mặt");
  const stamp = await items.first().locator("time").getAttribute("datetime");
  expect(Date.parse(stamp!)).toBeGreaterThanOrEqual(before - 60_000);
  expect(Date.parse(stamp!)).toBeLessThanOrEqual(Date.now() + 60_000);
  await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible(); // đầu nhóm ngày
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("lọc theo loại và theo ngày; bộ lọc nằm trên URL", async ({ page }) => {
  await withSql(async (sql) => {
    const { classN, glvN } = state();
    const sessionId = (await sql`insert into sessions (class_id, term_id, held_on) values (${classN}, (select id from terms order by starts_on, id limit 1), ${todayInVietnam()}) returning id`)[0].id as string;
    const kid = (await sql`select id from students where class_id = ${classN} and full_name = 'Nhật Ký Một'`)[0].id as string;
    await sql`insert into audit_events (at, actor_id, class_id, entity, action, summary) values
      (now() - interval '5 minutes', ${glvN}, ${classN}, 'student', 'student.create', ${sql.json({ studentName: "Em Lọc Thiếu Nhi" })}),
      (now() - interval '4 minutes', ${glvN}, ${classN}, 'seating_plan', 'seating.create', ${sql.json({ planName: "Sơ đồ Lọc", templateId: null, active: false })}),
      (now() - interval '3 minutes', ${glvN}, ${classN}, 'attendance', 'attendance.bulk_present', ${sql.json({ count: 2, batchId: "b", sessionDate: todayInVietnam(), sessionKind: "class" })}),
      (now() - interval '10 days', ${glvN}, ${classN}, 'student', 'student.create', ${sql.json({ studentName: "Em Từ Lâu" })})`;
    await sql`insert into attendance_scans (event_id, kind, session_id, student_id, actor_id, mode, payload_hash, new_status, result)
      values (${crypto.randomUUID()}, 'scan', ${sessionId}, ${kid}, ${glvN}, 'present', 'h', 'present', 'applied'),
             (${crypto.randomUUID()}, 'scan', ${sessionId}, ${kid}, ${glvN}, 'present', 'h2', null, 'noop')`;
  });
  await login(page, "glv-n@e2e.vn");
  const url = `/lop/${state().classN}/nhat-ky`;
  await page.goto(url);
  const rows = page.getByRole("listitem").filter({ has: page.locator("time") });
  await expect(rows).toHaveCount(5); // 3 dòng hôm nay + quét thẻ (chỉ lượt đã áp dụng) + dòng cũ
  await expect(rows.filter({ hasText: "quét thẻ Nhật Ký Một (chế độ Có mặt)" })).toHaveCount(1);

  await page.getByRole("navigation", { name: "Lọc theo loại" }).getByRole("link", { name: "Thiếu nhi", exact: true }).click();
  await expect(page).toHaveURL(/loai=thieu-nhi/);
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("thêm em Em Lọc Thiếu Nhi");

  await page.getByRole("link", { name: "Quét thẻ", exact: true }).click();
  await expect(page).toHaveURL(/loai=quet-the/);
  await expect(rows).toHaveCount(1);

  await page.getByRole("navigation", { name: "Lọc theo loại" }).getByRole("link", { name: "Sơ đồ", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('tạo sơ đồ "Sơ đồ Lọc"');

  // Lọc ngày: chỉ hôm nay, giữ loại "Thiếu nhi" khi đổi ngày.
  await page.getByRole("navigation", { name: "Lọc theo loại" }).getByRole("link", { name: "Thiếu nhi", exact: true }).click();
  await expect(page).toHaveURL(/loai=thieu-nhi/);
  await page.getByLabel("Từ ngày").fill(todayInVietnam());
  await page.getByLabel("Đến ngày").fill(todayInVietnam());
  await page.getByRole("button", { name: "Lọc" }).click();
  await expect(page).toHaveURL(/tu=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/den=\d{4}-\d{2}-\d{2}/);
  const q = new URL(page.url()).searchParams;
  expect([q.get("tu"), q.get("den"), q.get("loai")]).toEqual([todayInVietnam(), todayInVietnam(), "thieu-nhi"]);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Em Lọc Thiếu Nhi");
  await expect(rows.filter({ hasText: "Em Từ Lâu" })).toHaveCount(0);
  const filteredUrl = page.url();

  // Địa chỉ chia sẻ được: mở lại cho cùng kết quả; "Xoá lọc" về đủ 5 dòng.
  await page.goto(filteredUrl);
  await expect(rows).toHaveCount(1);
  await page.getByRole("link", { name: "Xoá lọc" }).click();
  await expect(rows).toHaveCount(5);

  await page.getByRole("navigation", { name: "Lọc theo loại" }).getByRole("link", { name: "Điểm danh", exact: true }).click();
  await expect(rows).toHaveCount(2); // dòng "Tất cả có mặt" + lượt quét thẻ của buổi học
  await expect(rows.filter({ hasText: 'bấm "Tất cả có mặt": 2 em' })).toHaveCount(1);
  await expect(rows.filter({ hasText: "quét thẻ Nhật Ký Một" })).toHaveCount(1);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("trang trống có lời nhắn, bộ lọc không khớp có lời nhắn riêng", async ({ page }) => {
  await login(page, "glv-n@e2e.vn");
  await page.goto(`/lop/${state().classN}/nhat-ky`);
  await expect(page.getByText("Chưa có dòng nhật ký nào")).toBeVisible();
  await page.getByRole("navigation", { name: "Lọc theo loại" }).getByRole("link", { name: "Sơ đồ", exact: true }).click();
  await expect(page.getByText("Không có thay đổi nào khớp bộ lọc này.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Xem thêm" })).toHaveCount(0);
});

test("hơn 50 dòng: 'Xem thêm' sang trang sau bằng mốc trên URL, không trùng, không sót", async ({ page }) => {
  await seedStudentEvents(58);
  await login(page, "glv-n@e2e.vn");
  await page.goto(`/lop/${state().classN}/nhat-ky`);
  const rows = page.getByRole("listitem").filter({ has: page.locator("time") });
  await expect(rows).toHaveCount(50);
  await expect(rows.first()).toContainText("Em Nhật 001");
  await expect(rows.last()).toContainText("Em Nhật 050");
  const more = page.getByRole("link", { name: "Xem thêm" });
  expect((await more.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(page).toHaveURL(/sau=[A-Za-z0-9_-]+/);
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText("Em Nhật 051");
  await expect(rows.last()).toContainText("Em Nhật 058");
  await expect(page.getByRole("link", { name: "Xem thêm" })).toHaveCount(0);
  await page.getByRole("link", { name: "Về đầu danh sách" }).click();
  await expect(page).not.toHaveURL(/sau=/);
  await expect(rows).toHaveCount(50);

  // Mốc hỏng: về trang đầu, không lỗi.
  await page.goto(`/lop/${state().classN}/nhat-ky?sau=khong-hop-le`);
  await expect(rows).toHaveCount(50);
  expect(await noHorizontalScroll(page)).toBe(true);
});

test("trưởng khối (chỉ đọc) mở được nhật ký của lớp khối mình", async ({ page }) => {
  await seedStudentEvents(3);
  await login(page, "head-a@e2e.vn");
  await page.goto(`/lop/${state().classN}/nhat-ky`);
  await expect(page.getByRole("heading", { name: "Nhật ký thay đổi" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "GLV N thêm em Em Nhật 001" })).toBeVisible();
});

test("người ngoài quyền (GLV khối khác, trưởng khối khác) nhận 404, không lộ dòng nhật ký", async ({ page }) => {
  await seedStudentEvents(2);
  for (const email of ["glv-b@e2e.vn", "head-b@e2e.vn"]) {
    await login(page, email);
    const res = await page.goto(`/lop/${state().classN}/nhat-ky`);
    expect(res?.status(), email).toBe(404);
    await expect(page.getByText("Em Nhật 001")).toHaveCount(0);
    await page.context().clearCookies();
  }
});

test("mốc phân trang giả và ngày bất thường không gây lỗi 500: về trang đầu, bỏ bộ lọc sai", async ({ page }) => {
  await seedStudentEvents(3);
  await login(page, "glv-n@e2e.vn");
  const rows = page.getByRole("listitem").filter({ has: page.locator("time") });
  const forged = (at: string) => Buffer.from(JSON.stringify({ a: at, i: crypto.randomUUID() })).toString("base64url");
  for (const query of [
    `sau=${forged("2026-02-30T05:00:00.123456Z")}`, `sau=${forged("0000-01-01T00:00:00.000000Z")}`, `sau=${forged("0001-01-01T00:00:00.000000Z")}`,
    "tu=0001-01-01", "den=0000-01-01", "tu=0001-01-01&den=9999-12-31", "sau=%00%00&tu=2026-02-30",
  ]) {
    const res = await page.goto(`/lop/${state().classN}/nhat-ky?${query}`);
    expect(res?.status(), query).toBe(200);
    await expect(rows, query).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Xoá lọc" }), query).toHaveCount(0); // bộ lọc sai đã bị bỏ
  }
  await page.goto(`/lop/${state().classN}/nhat-ky?tu=2026-12-31&den=2026-01-01`);
  await expect(page.getByText("Ngày bắt đầu sau ngày kết thúc.")).toBeVisible();
  await expect(rows).toHaveCount(0);
});
