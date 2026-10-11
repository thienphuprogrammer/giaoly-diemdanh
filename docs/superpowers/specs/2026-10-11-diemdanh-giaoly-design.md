# Web điểm danh lớp giáo lý — Thiết kế

Ngày: 2026-10-11 · Trạng thái: đã duyệt (2026-10-11); điều chỉnh khi lập kế hoạch: bỏ Auth.js, thêm `id` cho `gap`, trưởng khối xác định bằng `users.grade_id`

## 1. Mục tiêu

Giáo lý viên (GLV) điểm danh lớp giáo lý nhanh ngay tại lớp bằng điện thoại hoặc tablet,
và biết sớm em nào vắng không phép từ 2 buổi trở lên trong một học kỳ.

**Thành công khi:** điểm danh một lớp ~25 em trong vài chục giây, thấy cảnh báo ngay khi bấm,
trưởng khối nắm được tình hình cả khối.

### Phạm vi MVP
- Danh sách thiếu nhi của lớp, import CSV.
- Sơ đồ chỗ ngồi tùy chỉnh theo lớp (hàng → băng → ghế).
- Điểm danh theo buổi: chế độ sơ đồ và chế độ checklist.
- Đếm vắng, cảnh báo, thống kê, xuất Excel.
- Hai vai trò hiệu lực: GLV và trưởng khối.

### Ngoài phạm vi MVP
Thông báo phụ huynh, chạy offline/đồng bộ lại, QR/tự check-in, nhận diện khuôn mặt,
đơn xin nghỉ online, sơ đồ kéo-thả tự do, giao diện laptop riêng (chỉ co giãn).

## 2. Quy tắc nghiệp vụ

- Trạng thái điểm danh: `present`, `absent_excused`, `absent_unexcused`, `late`.
  Chưa điểm danh = không có bản ghi (không tính vào bất kỳ thống kê nào).
- Đếm theo **học kỳ**, riêng từng em. Chỉ `absent_unexcused` tính vào ngưỡng.
  `late` và `absent_excused` không tính.
- Cảnh báo: `none` (0 buổi) → `watch` (vàng, 1 buổi) → `warning` (đỏ, ≥ 2 buổi).
  Ngưỡng cấu hình được (mặc định 2). Đã hiện thực tại `src/lib/attendance/warning.ts`.
- Buổi nghỉ lễ (`cancelled`) không được tính vào thống kê.
- Mỗi lớp có tối đa 1 buổi/ngày.

## 3. Mô hình dữ liệu (Postgres + Drizzle)

Thực thể: `users` (cờ `is_grade_head`, `grade_id` = khối của tài khoản), `school_years`, `terms`, `grades`,
`classes`, `class_catechists`, `students` (tên thánh, họ tên, ngày sinh, SĐT phụ huynh,
ghi chú, `active`), `seating_plans`, `seat_assignments`, `sessions`, `attendance`.

### Sơ đồ băng ghế
```
seating_plans.layout = [
  { id, items: [ {type:"bench", id, seats:2..4}, {type:"gap", id}, ... ] },
  ...
]
```
- Băng có `id` cố định (uuid). Ghế xác định bởi `(benchId, seatIndex)`.
- `seat_assignments(plan_id, bench_id, seat_index, student_id)`; duy nhất theo
  `(plan_id, bench_id, seat_index)` và theo `(plan_id, student_id)`.
- Quy tắc kiểm tra (hàm thuần, `src/lib/seating`): 2–4 ghế/băng; tối đa 12 hàng,
  8 băng/hàng; một em một ghế/sơ đồ; xóa băng → các em trong băng về "chưa xếp chỗ".
- Mỗi lớp có nhiều sơ đồ, đúng 1 sơ đồ đang dùng (`is_active`).
- Điểm danh lưu theo `(session_id, student_id)`, **không** lưu theo ghế, nên đổi sơ đồ
  không làm sai lịch sử.

> Lưu ý: schema tạm thời trong `src/db/schema.ts` còn theo lưới `row/col`; sẽ được sửa
> theo mô hình này ở mốc 3. Thiếu nhi chỉ bị ẩn (`active=false`), không xóa cứng.

## 4. Luồng điểm danh

- **Mở buổi:** nút "Điểm danh hôm nay"; tạo buổi khi cần (không sinh sẵn cả học kỳ);
  chọn ngày khác để điểm danh bù; công tắc nghỉ lễ.
- **Mặc định là chưa điểm danh.** Nút "Tất cả có mặt" chỉ điền cho em chưa điểm danh.
- **Chế độ sơ đồ:** chạm = đổi qua lại có mặt ⇄ vắng không phép; nhấn giữ (hoặc chạm huy
  hiệu) = bảng chọn vắng có phép / đi muộn + lý do. Em chưa xếp ghế ở khay "Chưa xếp chỗ".
  Ghế chưa gán em thì khóa.
- **Chế độ checklist:** mỗi em một dòng, nút Có mặt / Vắng / ⋯. Dùng chung dữ liệu với sơ đồ.
- **Lưu tự động** từng lần chạm; đầu trang hiện "Đã điểm danh x/y". Lỗi lưu → ghế viền đỏ +
  nút thử lại, không bỏ qua im lặng.
- **Cảnh báo tức thời:** huy hiệu cập nhật ngay khi chạm, đã tính cả buổi đang mở.
- **Sửa buổi cũ:** GLV của lớp sửa được; lưu `updated_by`, `updated_at`; không có luồng duyệt.
- Mất mạng: báo lỗi rõ ràng (offline nằm ngoài MVP).

## 5. Màn hình và điều hướng

Thanh dưới cùng: **Lớp của tôi · Cần chú ý · Khối** (chỉ trưởng khối) **· Tài khoản**.

| Màn hình | Nội dung |
|---|---|
| Đăng nhập | Email + mật khẩu; không đăng ký công khai |
| Lớp của tôi | Thẻ lớp: số em, buổi gần nhất, số em cần chú ý, nút điểm danh |
| Trang lớp | Tab: Điểm danh · Thiếu nhi · Sơ đồ · Thống kê |
| Thiếu nhi | Thêm/sửa, import CSV (xem trước, lỗi theo dòng), ẩn em |
| Sơ đồ | Editor hàng/băng/ghế, gán em, nhiều sơ đồ, chọn sơ đồ đang dùng |
| Thống kê | Theo học kỳ, bảng từng em, huy hiệu, xuất Excel |
| Cần chú ý | Em chạm ngưỡng, gom theo lớp; trưởng khối thấy cả khối |
| Khối | Tổng quan lớp trong khối: tỉ lệ chuyên cần, số em cảnh báo |

## 6. Phân quyền

Kiểm tra ở server qua một hàm duy nhất `canAccess(user, classId, "read" | "write")`
(`src/lib/access`).

- **GLV:** đọc và ghi lớp được gán.
- **Trưởng khối:** đọc mọi lớp trong khối; ghi chỉ ở lớp được gán (muốn ghi lớp khác thì
  tự gán mình vào lớp đó). Quản lý lớp, tài khoản GLV, việc gán GLV, đặt lại mật khẩu
  trong khối của mình.
- Tài khoản trưởng khối đầu tiên, năm học, học kỳ: tạo bằng script seed một lần.
- Không đủ quyền → 403, không tiết lộ lớp có tồn tại hay không.

## 7. Kiến trúc

- `src/lib/*`: hàm thuần, không đụng DB, trả về bản sao mới (`attendance`, `seating`,
  `access`, `import`).
- `src/db/*`: schema + truy vấn gom theo nhóm (repository).
- `src/app/*`: route. Phần lớn Server Component; Client Component chỉ cho editor sơ đồ và
  màn hình điểm danh.
- Mọi thao tác ghi là Server Action: xác thực → `canAccess` → validate zod → ghi DB;
  trả `{ok:true,data}` hoặc `{ok:false,error}`.
- Next.js (App Router, TypeScript, Tailwind), Postgres hosted (Neon/Supabase), Drizzle,
  session stateless `jose` + cookie `httpOnly` (cookie chỉ chứa `userId`, quyền đọc lại từ DB mỗi request; theo hướng dẫn xác thực của Next 16), deploy Vercel. PWA ở mốc cuối.

## 8. Xử lý lỗi và bảo mật

- Validate ở biên bằng zod, thông báo tiếng Việt dễ hiểu.
- Import báo lỗi theo từng dòng; các dòng hợp lệ dùng được sau khi người dùng xác nhận.
- Lỗi DB ghi log chi tiết ở server, người dùng chỉ thấy thông báo chung.
- bcrypt cho mật khẩu, giới hạn đăng nhập sai, secret chỉ ở biến môi trường, không commit
  `.env*`.
- **Dependency:** gói `xlsx` trên npm đã cũ và có lỗ hổng đã biết → gỡ khỏi `package.json`.
  Import chỉ nhận **CSV** (tự parse, không cần thư viện); **xuất Excel** dùng `exceljs`.

## 9. Kiểm thử (TDD, ≥ 80% coverage)

- **Unit:** `warning` (đã xong, 8 test), `seating`, `access`, parse import.
- **Integration:** Server Action trên database test riêng, gồm các ca bị từ chối quyền.
- **E2E (Playwright)** ở 375px và 768px: đăng nhập → mở buổi → điểm danh bằng sơ đồ →
  thấy cảnh báo → xem ở "Cần chú ý"; một luồng kiểm tra phân quyền giữa hai GLV.

## 10. Thứ tự triển khai

Mỗi mốc chạy được độc lập và qua code-reviewer (mốc 1 thêm security-reviewer).

1. Đăng nhập, `canAccess`, script seed.
2. Lớp và thiếu nhi, import CSV.
3. Editor sơ đồ băng ghế và gán chỗ (sửa schema theo mục 3).
4. Điểm danh (chế độ sơ đồ và checklist).
5. Thống kê, "Cần chú ý", trang Khối, xuất Excel.
6. PWA và chỉnh giao diện.
