import { readFileSync } from "node:fs";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";
import { todayInVietnam } from "../src/lib/dates";
import { addDays } from "../src/lib/school-year/defaults";

interface State { gradeD: string; classD1: string; classD2: string; planD: string; gradeC: string }
const state = () => JSON.parse(readFileSync("e2e/.state.json", "utf8")) as State;
const LOGIN_PW = "e2e-password-1";
const MOVED = ["Lên Lớp Một", "Lên Lớp Hai"];

async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.E2E_DATABASE_URL!, { max: 1 });
  try { return await fn(sql); } finally { await sql.end(); }
}

/** Đưa Khối D về trạng thái ban đầu: mọi em ở Lớp D1, chỗ ngồi của "Lên Lớp Một", không lượt lên lớp, không khối kế tiếp. */
async function resetGradeD() {
  await withSql(async (sql) => {
    const { gradeD, classD1, classD2, planD } = state();
    await sql`delete from promotions where from_class_id in (${classD1}, ${classD2})`;
    await sql`delete from audit_events where grade_id = ${gradeD} or (action = 'grade.next_grade' and entity_id = ${gradeD})`;
    await sql`update students set class_id = ${classD1} where class_id in (${classD1}, ${classD2})`;
    await sql`update grades set next_grade_id = null where id = ${gradeD}`;
    await sql`delete from school_years where name like 'E2E mới%'`;
    await sql`insert into seat_assignments (plan_id, bench_id, seat_index, student_id)
      select ${planD}, 'b1', 0, id from students where full_name = 'Lên Lớp Một' and class_id = ${classD1}
      on conflict do nothing`;
  });
}

test.beforeEach(resetGradeD);
// Năm học tạo trong test phải biến mất để các spec sau giữ nguyên các năm học đã gieo.
test.afterEach(resetGradeD);

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu").fill(LOGIN_PW);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
}

const tokensOf = (names: string[]) => withSql(async (sql) =>
  (await sql<{ full_name: string; qr_token: string; class_id: string }[]>`select full_name, qr_token, class_id from students where full_name in ${sql(names)} order by full_name`));

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("trưởng khối tạo năm học mới từ trang Khối", async ({ page }, info) => {
  const name = `E2E mới ${info.project.name}`;
  await login(page, "head-d@e2e.vn");
  await page.goto("/khoi");
  await page.getByRole("link", { name: /Năm học mới và lên lớp/ }).click();
  await expect(page.getByRole("heading", { name: "Năm học và lên lớp" })).toBeVisible({ timeout: 30_000 });
  expect(await noHorizontalScroll(page)).toBe(true);
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "Tạo năm học mới" }) });
  // Mặc định đã điền sẵn (năm học trước chỉ có một học kỳ nên đề xuất tháng 9 → tháng 5).
  await expect(form.getByLabel("Tên học kỳ").first()).toHaveValue("Học kỳ 1");
  await expect(form.locator("input[name=term1Start]")).toHaveValue(/^\d{4}-09-01$/);
  // Năm kế tiếp đã gieo từ ngày +180 đến +300. Tạo năm khác tiếp ngay sau đó,
  // gồm 200 ngày và vẫn nằm trong giới hạn ngày bắt đầu của trưởng khối.
  await form.getByLabel("Tên năm học").fill(name);
  const dates = ["term1Start", "term1End", "term2Start", "term2End"] as const;
  const today = todayInVietnam();
  const used = [301, 400, 401, 500].map((offset) => addDays(today, offset));
  for (const [i, d] of dates.entries()) await form.locator(`input[name=${d}]`).fill(used[i]);
  await form.getByRole("button", { name: "Tạo năm học" }).click();
  await expect(form.getByRole("status")).toHaveText("Đã tạo năm học");
  await expect(page.getByRole("list", { name: "Các năm học" }).getByText(name)).toBeVisible();
  // Tạo lại cùng tên (cùng ngày) bị từ chối.
  await form.getByLabel("Tên năm học").fill(name);
  for (const [i, d] of dates.entries()) await form.locator(`input[name=${d}]`).fill(used[i]);
  await form.getByRole("button", { name: "Tạo năm học" }).click();
  await expect(form.getByRole("alert")).toHaveText("Đã có năm học tên này");
  // Năm học chưa có buổi nào xoá được (hỏi lại một lần); năm học E2E đã có buổi thì không có nút xoá.
  await expect(page.getByRole("button", { name: "Xoá năm học E2E", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: `Xoá năm học ${name}` }).click();
  await page.getByRole("list", { name: "Các năm học" }).getByRole("button", { name: "Xoá năm học", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: `Đã xoá năm học ${name}` })).toBeVisible();
  await expect(page.getByRole("list", { name: "Các năm học" }).getByText(name)).toHaveCount(0);
});

test("lên lớp 2 em sang lớp khác: giữ thẻ QR, rời lớp cũ, hoàn tác được", async ({ page, browser }) => {
  const { classD1, classD2 } = state();
  const before = await tokensOf(MOVED);
  await login(page, "head-d@e2e.vn");
  await page.goto("/khoi/nam-hoc");
  await page.getByLabel("Lớp hiện tại").selectOption(classD1);
  await page.getByRole("combobox", { name: /^Lên lớp/ }).selectOption(classD2);
  await page.getByRole("button", { name: "Xem danh sách em" }).click();
  const list = page.getByRole("list", { name: "Các em sẽ lên lớp" });
  await expect(list.getByRole("checkbox")).toHaveCount(3);
  for (const box of await list.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await list.getByText("Ở Lại Ba").click(); // bỏ chọn em ở lại
  const row = list.locator("label").first();
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole("button", { name: "Lên lớp 2 em" }).click();
  const sheet = page.getByRole("dialog", { name: "Xác nhận lên lớp" });
  await expect(sheet.getByText("Giữ thẻ QR và lịch sử điểm danh. Chỗ ngồi cũ sẽ bị xoá. Có thể hoàn tác trong 24 giờ.")).toBeVisible();
  await sheet.getByRole("button", { name: "Xác nhận lên lớp" }).click();
  await expect(page.getByText("Đã chuyển 2 em từ Lớp D1 (E2E) sang Lớp D2 (E2E). Đã xoá 1 chỗ ngồi ở lớp cũ.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Các lượt lên lớp" }).getByText("Lớp D1 → Lớp D2")).toBeVisible();
  await expect(page.getByRole("list", { name: "Các lượt lên lớp" }).getByText("Năm học E2E → E2E")).toBeVisible();

  // Thẻ QR không đổi, em thuộc lớp mới.
  const after = await tokensOf(MOVED);
  expect(after.map((r) => r.qr_token)).toEqual(before.map((r) => r.qr_token));
  expect(after.map((r) => r.class_id)).toEqual([classD2, classD2]);

  // GLV lớp mới thấy em trong danh sách và trang thẻ QR; HTML không lộ mã thẻ.
  const glv = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const glvPage = await glv.newPage();
  await login(glvPage, "glv-d2@e2e.vn");
  await glvPage.goto(`/lop/${classD2}/thieu-nhi`);
  for (const n of MOVED) await expect(glvPage.getByText(n, { exact: true })).toBeVisible();
  let html = await glvPage.content();
  for (const t of after) expect(html).not.toContain(t.qr_token);
  await glvPage.goto(`/lop/${classD2}/thieu-nhi/the-qr`);
  for (const n of MOVED) await expect(glvPage.getByRole("img", { name: `Mã QR của ${n}` })).toBeVisible();
  html = await glvPage.content();
  for (const t of after) expect(html).not.toContain(t.qr_token);
  await glv.close();

  // Lớp cũ lưu lịch sử thành viên: hai em không còn trong danh sách đang học,
  // nhưng vẫn hiện trong bộ lọc đã chuyển lớp.
  await page.goto(`/lop/${classD1}/thieu-nhi`);
  await page.getByRole("combobox", { name: "Trạng thái", exact: true }).selectOption("active");
  await expect(page.getByText("Ở Lại Ba", { exact: true })).toBeVisible();
  for (const n of MOVED) await expect(page.getByText(n, { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Trạng thái", exact: true }).selectOption("former");
  for (const n of MOVED) await expect(page.getByText(n, { exact: true })).toBeVisible();
  await expect(page.getByText("Ở Lại Ba", { exact: true })).toHaveCount(0);

  // Hoàn tác từ danh sách các lượt lên lớp.
  await page.goto("/khoi/nam-hoc");
  await page.getByRole("button", { name: "Hoàn tác lên lớp Lớp D1 → Lớp D2" }).click();
  await page.getByRole("button", { name: "Xác nhận hoàn tác" }).click();
  await expect(page.getByText("Đã trả 2 em về Lớp D1. Chỗ ngồi cũ không được khôi phục.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Các lượt lên lớp" }).getByText("Đã hoàn tác")).toBeVisible();
  expect((await tokensOf(MOVED)).map((r) => r.class_id)).toEqual([classD1, classD1]);
});

test("hoàn tác ngay sau khi lên lớp từ màn kết quả", async ({ page }) => {
  const { classD1, classD2 } = state();
  await login(page, "head-d@e2e.vn");
  await page.goto("/khoi/nam-hoc");
  await page.getByLabel("Lớp hiện tại").selectOption(classD1);
  await page.getByRole("combobox", { name: /^Lên lớp/ }).selectOption(classD2);
  await page.getByRole("button", { name: "Xem danh sách em" }).click();
  await page.getByRole("button", { name: "Lên lớp 3 em" }).click();
  await page.getByRole("dialog", { name: "Xác nhận lên lớp" }).getByRole("button", { name: "Xác nhận lên lớp" }).click();
  await expect(page.getByText("Đã chuyển 3 em từ Lớp D1 (E2E) sang Lớp D2 (E2E).", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Hoàn tác", exact: true }).click();
  await expect(page.getByText("Đã trả 3 em về Lớp D1 (E2E). Chỗ ngồi cũ không được khôi phục.")).toBeVisible();
  const rows = await withSql((sql) => sql<{ n: number }[]>`select count(*)::int as n from students where class_id = ${state().classD1}`);
  expect(rows[0].n).toBe(3);
});

test("khối kế tiếp: hỏi xác nhận rồi mở thêm lớp của khối đó làm lớp đích", async ({ page, browser }) => {
  await login(page, "head-d@e2e.vn");
  await page.goto("/khoi/nam-hoc");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: /Khối kế tiếp/ }) });
  await form.getByLabel("Khối kế tiếp").selectOption({ label: "Khối E2E C" });
  await form.getByRole("button", { name: "Lưu khối kế tiếp" }).click();
  await expect(form.getByText(/chuyển được thiếu nhi của Khối E2E D vào các lớp của/)).toBeVisible();
  await form.getByRole("button", { name: "Xác nhận" }).click();
  await expect(form.getByRole("status").filter({ hasText: "Đã lưu khối kế tiếp" })).toBeVisible();
  await page.getByLabel("Lớp hiện tại").selectOption(state().classD1);
  await expect(page.getByRole("combobox", { name: /^Lên lớp/ }).locator("optgroup[label='Khối E2E C'] option")).toHaveText(["Lớp M · E2E"]);

  // Trưởng khối được chọn thấy băng báo trên màn "Năm học" của mình.
  const other = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const otherPage = await other.newPage();
  await login(otherPage, "head-c@e2e.vn");
  await otherPage.goto("/khoi/nam-hoc");
  await expect(otherPage.getByRole("complementary", { name: "Thay đổi từ khối khác" }))
    .toContainText("Trưởng khối D đặt khối kế tiếp của Khối E2E D: chưa có → Khối E2E C");
  await other.close();
});

test("giáo lý viên không vào được màn năm học", async ({ page }) => {
  await login(page, "glv-d1@e2e.vn");
  await page.goto("/khoi/nam-hoc");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Trang chủ" })).toBeVisible();
});
