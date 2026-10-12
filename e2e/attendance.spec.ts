import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { todayInVietnam } from "../src/lib/dates";

const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as { classA: string; classB: string; classC: string };
const EDIT_NAME = "Trần Sửa"; // khớp e2e/global-setup.ts
const LOGIN_PW = "e2e-password-1";

// global-setup chạy một lần cho cả hai project nên xóa buổi hôm nay trước mỗi test để test độc lập.
test.beforeEach(async () => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`delete from sessions where held_on = ${todayInVietnam()}`;
  } finally {
    await sql.end();
  }
});

async function login(page: Page, email: string, password = LOGIN_PW) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
}

test("điểm danh bằng sơ đồ, thấy cảnh báo và danh sách Cần chú ý", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  // Một chạm từ thẻ lớp ở trang chủ.
  const card = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /Lớp A/ }) });
  await card.getByRole("link", { name: "Điểm danh hôm nay" }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}/diem-danh/${todayInVietnam()}$`));

  await page.getByRole("button", { name: "Tất cả có mặt" }).click();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();

  // An đã vắng 1 buổi trước đó; chạm để đánh vắng buổi này => đủ 2 buổi => cảnh báo.
  await page.getByRole("button", { name: /Nguyễn An: Có mặt/ }).click();
  await expect(page.getByRole("button", { name: /Nguyễn An: Vắng không phép/ })).toBeVisible();
  await expect(page.getByLabel("Cảnh báo vắng")).toBeVisible();

  // Nhấn giữ mở bảng chọn trạng thái.
  const binh = page.getByRole("button", { name: /Nguyễn Bình: / });
  await binh.hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /Điểm danh Nguyễn Bình/ })).toBeVisible();
  await page.getByRole("button", { name: "Vắng có phép" }).click();
  await expect(page.getByRole("button", { name: /Nguyễn Bình: Vắng có phép/ })).toBeVisible();

  // Chế độ danh sách dùng cùng dữ liệu.
  await page.getByRole("tab", { name: "Danh sách" }).click();
  await expect(page.getByRole("button", { name: "Vắng", exact: true, pressed: true })).toHaveCount(1);

  await page.goto("/can-chu-y");
  await expect(page.getByText("Nguyễn An")).toBeVisible();
  await expect(page.getByText(/Cảnh báo · 2 buổi/)).toBeVisible();
});

async function openBoard(page: Page) {
  await login(page, "glv-a@e2e.vn");
  await page.goto(`/lop/${state().classA}/diem-danh/${todayInVietnam()}`);
  await expect(page.getByText(/Đã điểm danh 0\/4/)).toBeVisible();
}

test("trạng thái lưu, hoàn tác Tất cả có mặt và xác nhận nghỉ lễ", async ({ page }) => {
  await openBoard(page);

  // Dải "…" của ô ghế đủ vùng chạm 44px.
  const options = await page.getByRole("button", { name: "Mở lựa chọn cho Nguyễn An" }).boundingBox();
  expect(options?.height ?? 0).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();

  await page.getByRole("button", { name: "Tất cả có mặt" }).click();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();
  await expect(page.getByText("Đã ghi có mặt 3 em")).toBeVisible();
  await page.getByRole("button", { name: "Hoàn tác" }).click();
  await expect(page.getByText("Đã điểm danh 1/4")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Đã điểm danh 1/4")).toBeVisible(); // máy chủ cũng đã hoàn tác

  // Đã có dấu điểm danh => bật nghỉ lễ phải hỏi lại; Huỷ thì giữ nguyên.
  await page.getByText("Buổi nghỉ lễ", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Đánh dấu buổi nghỉ lễ?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByText("Buổi nghỉ lễ", { exact: true }).click();
  await dialog.getByRole("button", { name: "Nghỉ lễ" }).click();
  await expect(page.getByText("Buổi nghỉ lễ — không tính vào thống kê.")).toBeVisible();
});

test("kết thúc buổi: đánh vắng các em còn lại có xác nhận, chỉ ghi em chưa có dấu, lỗi thì thử lại", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: /Nguyễn Bình: chưa điểm danh/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();

  const open = page.getByRole("button", { name: "Đánh vắng 3 em còn lại" });
  await expect(open).toBeVisible();
  expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Đánh vắng các em còn lại" });
  const names = dialog.getByRole("list", { name: "Các em sẽ bị đánh vắng" });
  await expect(names).toContainText("Nguyễn An");
  await expect(names).toContainText("Nguyễn Chi");
  await expect(names).toContainText("Nguyễn Dũng");
  await expect(names).not.toContainText("Nguyễn Bình");
  await expect(dialog).toContainText("vắng không phép");
  await expect(dialog).toContainText("có phép");
  await dialog.getByRole("button", { name: "Huỷ" }).click();
  await expect(page.getByText("Đã điểm danh 1/4")).toBeVisible();

  // Mạng lỗi: báo lỗi kèm "Thử lại", chưa ghi gì.
  const boardPath = new URL(page.url()).pathname;
  const isBoard = (url: URL) => url.pathname === boardPath;
  await page.route(isBoard, (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
  await open.click();
  await dialog.getByRole("button", { name: "Đánh vắng", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Không lưu được" })).toBeVisible();
  await expect(page.getByText("Đã điểm danh 1/4")).toBeVisible();
  await page.unroute(isBoard);

  await page.getByRole("button", { name: "Thử lại đánh vắng" }).click();
  await dialog.getByRole("button", { name: "Đánh vắng", exact: true }).click();
  await expect(page.getByText("Đã điểm danh 4/4")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Đánh vắng \d+ em còn lại/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Nguyễn Chi: Vắng không phép/ })).toBeVisible();

  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql`
      select st.full_name, a.status, a.last_event_id from attendance a
      join sessions se on se.id = a.session_id join students st on st.id = a.student_id
      where se.held_on = ${todayInVietnam()} and se.class_id = ${state().classA} order by st.full_name`;
    expect(rows.map((r) => [r.full_name, r.status, r.last_event_id])).toEqual([
      ["Nguyễn An", "absent_unexcused", null], ["Nguyễn Bình", "present", null], ["Nguyễn Chi", "absent_unexcused", null], ["Nguyễn Dũng", "absent_unexcused", null],
    ]);
  } finally {
    await sql.end();
  }

  // An đã vắng buổi trước + buổi này => cảnh báo; Chi/Dũng mới 1 buổi.
  await page.goto("/can-chu-y");
  await expect(page.getByText("Nguyễn An")).toBeVisible();
  await expect(page.getByText(/Cảnh báo · 2 buổi/)).toBeVisible();
});

test("bảng lấy dữ liệu mới khi tab hiện lại và khi quay lại bằng Back", async ({ page }) => {
  await openBoard(page);
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    // Thiết bị khác ghi "Đi muộn" cho Bình.
    const [row] = await sql`
      select st.id as student_id, se.id as session_id from students st
      join sessions se on se.class_id = st.class_id and se.held_on = ${todayInVietnam()}
      where st.class_id = ${state().classA} and st.full_name = 'Nguyễn Bình'`;
    await sql`insert into attendance (session_id, student_id, status) values (${row.session_id}, ${row.student_id}, 'late')`;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("button", { name: /Nguyễn Bình: Đi muộn/ })).toBeVisible();

    // Sang màn quét, thiết bị khác ghi thêm, bấm Back => bảng không hiện bản cũ đã cache.
    await page.getByRole("link", { name: "Quét QR" }).click();
    await expect(page).toHaveURL(/\/quet$/);
    const [chi] = await sql`select id from students where class_id = ${state().classA} and full_name = 'Nguyễn Chi'`;
    await sql`insert into attendance (session_id, student_id, status) values (${row.session_id}, ${chi.id}, 'absent_excused')`;
    await page.goBack();
    await expect(page.getByRole("button", { name: /Nguyễn Chi: Vắng có phép/ })).toBeVisible();
    await expect(page.getByText("Đã điểm danh 2/4")).toBeVisible();
    // Dữ liệu mới đã về => hết "Đang cập nhật…", chạm lại được.
    await expect(page.getByText("Đang cập nhật…")).toBeHidden();
    await expect(page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ })).toBeEnabled();
  } finally {
    await sql.end();
  }
});

test("Back của trình duyệt khi bảng còn lần lưu chưa xong thì hỏi lại", async ({ page }) => {
  await openBoard(page);
  const boardPath = new URL(page.url()).pathname;
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => { release = r; });
  // Giữ Server Action lưu điểm danh (POST cùng URL bảng) để lần lưu còn đang chờ.
  const isBoard = (url: URL) => url.pathname === boardPath;
  await page.route(isBoard, async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ }).click();
  await page.evaluate(() => history.back());
  const sheet = page.getByRole("dialog", { name: "Chưa lưu xong" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${boardPath}$`));
  await sheet.getByRole("button", { name: "Ở lại" }).click();
  release();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await page.unroute(isBoard);
  // Đã lưu xong: Back đi tiếp qua mục lịch sử chặn, về trang trước thật.
  await page.evaluate(() => history.back());
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
});

test("đã lưu xong rồi chuyển tab lớp: Back hai lần về trang trước bảng, không có lần Back chết", async ({ page }) => {
  await openBoard(page);
  const boardUrl = page.url();
  await page.getByRole("button", { name: /Nguyễn An: chưa điểm danh/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ✓" })).toBeVisible();
  await page.getByRole("tab", { name: "Thống kê" }).click();
  await expect(page).toHaveURL(/\/thong-ke$/);
  await page.goBack();
  await expect(page).toHaveURL(boardUrl);
  await expect(page.getByRole("button", { name: /Nguyễn An: Có mặt/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Lớp của tôi" })).toBeVisible();
});

test("báo mất mạng trên bảng điểm danh", async ({ page, context }) => {
  await openBoard(page);
  await context.setOffline(true);
  await expect(page.getByText(/Mất mạng — chưa lưu được/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/Mất mạng — chưa lưu được/)).toBeHidden();
});

test("GLV lớp khác không xem được lớp này", async ({ page }) => {
  await login(page, "glv-b@e2e.vn");
  const response = await page.goto(`/lop/${state().classA}`);
  expect(response?.status()).toBe(404);
});

test("không cuộn ngang trên màn hình điểm danh", async ({ page }) => {
  await login(page, "glv-a@e2e.vn");
  // Đi qua trang lớp (trang chủ cũng có nút "Điểm danh hôm nay" trên từng thẻ: chờ rời trang chủ trước).
  await page.getByRole("link", { name: /Lớp A/ }).click();
  await expect(page).toHaveURL(new RegExp(`/lop/${state().classA}$`));
  await page.getByRole("link", { name: "Điểm danh hôm nay" }).click();
  await expect(page.getByText(/Đã điểm danh/)).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("trưởng khối đặt lại mật khẩu GLV rồi GLV đăng nhập bằng mật khẩu mới", async ({ page, browser }) => {
  const newPw = `moi-${Date.now()}-e2e`;
  await login(page, "head-a@e2e.vn");
  await page.goto("/khoi");
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Đặt lại mật khẩu" }) });
  await form.getByLabel("Giáo lý viên").selectOption({ label: "GLV Reset" });
  await form.getByLabel("Mật khẩu mới (10–72 ký tự)").fill(newPw);
  await form.getByRole("button", { name: "Lưu" }).click();
  await expect(form.getByRole("status")).toHaveText("Đã lưu");

  const glvPage = await (await browser.newContext()).newPage();
  await login(glvPage, "glv-reset@e2e.vn", newPw);
  await glvPage.context().close();
});

test("người có quyền ghi sửa tên thiếu nhi ở tab Thiếu nhi và thấy tên mới", async ({ page }) => {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try {
    await sql`update students set full_name = ${EDIT_NAME} where class_id = ${state().classC}`;
  } finally {
    await sql.end();
  }
  await login(page, "head-a@e2e.vn"); // trưởng khối được gán vào Lớp C nên có quyền ghi
  await page.goto(`/lop/${state().classC}/thieu-nhi`);
  await page.getByRole("button", { name: "Sửa" }).click();
  await page.getByLabel("Họ và tên").fill(`${EDIT_NAME} Xong`);
  await page.getByRole("button", { name: "Lưu" }).click();
  await expect(page.getByText(`${EDIT_NAME} Xong`)).toBeVisible();
});
