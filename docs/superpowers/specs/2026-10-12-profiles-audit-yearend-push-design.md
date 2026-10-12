# Mốc 9 — Hồ sơ em, nhật ký, cuối năm, nhắc việc và bản iPhone (PWA)

Trạng thái: **đã chốt câu hỏi mở (12/10/2026), triển khai theo thứ tự P1 → P1b → P2 → P3 → P4 → P5**. Nền: nhánh `feat/qr-attendance` (Mốc 7–8 xong, 92 E2E / 573 unit xanh).
Người dùng đã chọn: PWA qua HTTPS; làm cả 4 nhóm tính năng: hồ sơ + lịch sử, nhật ký thay đổi, cuối năm, nhắc việc/thông báo; **thêm điểm danh đi lễ** (mục 1b).

## 0. Hiện trạng đã có (không làm lại)

Thiếu nhi có `parent_phone`, `note`, nhập CSV, xuất Excel thống kê (`thong-ke/export`), "Cần chú ý" (≥2 vắng không phép/học kỳ), quản trị khối (`/khoi`), manifest PWA + icon, quét QR, sơ đồ + mẫu. Chưa có: trang riêng từng em, lịch sử thay đổi, lịch học của lớp, năm học mới/lên lớp, push, bản triển khai.

## 1. Hồ sơ em + lịch sử điểm danh (P1)

- Trang `/lop/[classId]/thieu-nhi/[studentId]`: tên (tên thánh, họ tên, ngày sinh), tỉ lệ có mặt học kỳ hiện tại, số buổi có mặt/muộn/vắng có phép/vắng không phép, **danh sách buổi** (ngày, trạng thái, lý do), ghi chú (sửa được nếu có quyền ghi), số phụ huynh với nút **Gọi** (`tel:`) và **Nhắn Zalo** (`https://zalo.me/<số>`; thêm **SMS** `sms:`). Số điện thoại chuẩn hoá khi nhập (bỏ khoảng trắng, +84/0).
- Lối vào: bấm tên em ở danh sách thiếu nhi và ở "Cần chú ý" (nút "Gọi phụ huynh" ngay trên dòng cảnh báo).
- Quyền: đọc = người đọc được lớp (GLV, trưởng khối); sửa ghi chú/SĐT = GLV được phân công. 404 như cũ cho người ngoài. Dùng `studentColumns` (không có `qr_token`).
- Dữ liệu từ `attendance` + `sessions` + `terms` hiện có; không đổi schema (chỉ query mới, có test PGlite).

## 1b. Điểm danh đi lễ (P1b) — yêu cầu bổ sung 12/10/2026

Người dùng chốt: ghi nhận **cả hai cách**, **tính riêng với ngưỡng cảnh báo riêng**.

- **Mô hình**: `sessions` thêm cột `kind` (`'class'` mặc định | `'mass'`); khoá duy nhất đổi thành `(class_id, held_on, kind)`. Buổi `mass` là buổi thánh lễ Chúa nhật của lớp; dùng lại toàn bộ bảng `attendance` (`present` / `absent_excused` / `absent_unexcused`; **không có `late`**), `attendance_scans`, quét QR, hoàn tác, nhật ký. Mọi truy vấn hiện có phải lọc `kind='class'` (thống kê, "Cần chú ý", quy tắc ≥2 vắng không phép, xuất Excel, "Đánh vắng còn lại" của buổi học): có test hồi quy cho từng nơi.
- **Cách 1 — tích nhanh trong buổi học**: trên bảng điểm danh có phần "Đi lễ Chúa nhật" (gập được): nút "Cả lớp đi lễ" + chạm từng em (Có/Không/Chưa hỏi). Ghi vào buổi `mass` của **Chúa nhật gần nhất trên hoặc trước ngày học** (lớp học thứ Bảy → Chúa nhật liền trước; tạo buổi `mass` nếu chưa có). Mặc định "Chưa hỏi" = không có dòng.
- **Cách 2 — điểm danh tại nhà thờ**: nút "Điểm danh đi lễ" ở trang lớp mở màn quét (cùng màn hình/hàng đợi bền/hoàn tác) cho buổi `mass` hôm nay (hoặc Chúa nhật chọn); quét QR = `present`; chế độ "Đi muộn" ẩn; quét em đang `absent_*` vẫn hỏi xác nhận. Quyền: GLV được phân công lớp đó (như quét thường), mỗi lớp quét em của lớp mình.
- **Cảnh báo riêng**: số tuần **không đi lễ** trong học kỳ (**tuần đã ghi** = buổi `mass` chưa huỷ và có ít nhất một dòng điểm danh; em **vắng lễ** tuần đó nếu không có dòng `present` — kể cả không có dòng nào, vì quét tại nhà thờ không tạo dòng cho em vắng; tuần rỗng, tuần huỷ, tuần chưa mở không bị tính — quyết định 12/10/2026). Ngưỡng cảnh báo mặc định **2 tuần/học kỳ**, cấu hình theo khối (`grades.mass_threshold`, trưởng khối sửa). Hiện ở hồ sơ em, "Cần chú ý" (nhãn riêng "Đi lễ") và báo cáo học kỳ (cột riêng). Không làm đổi quy tắc vắng buổi học.
- **Nhật ký/nhắc việc**: hành động `attendance.*` có thêm `session_kind`; push trưởng khối khi chạm ngưỡng đi lễ (tối đa 1 lần/em/học kỳ/loại).
- **Ngoài phạm vi**: lễ trọng/lễ buộc ngoài Chúa nhật (có thể thêm buổi `mass` ngày bất kỳ thủ công), điểm cộng, thống kê cấp giáo xứ.

## 2. Nhật ký thay đổi (P2)

- Bảng `audit_events(id, at, actor_id, class_id, entity, entity_id, action, summary jsonb)`; `entity ∈ {attendance, student, seating_plan, session}`; `action` dạng `attendance.set`, `attendance.bulk_present`, `attendance.bulk_undo`, `attendance.remaining_absent`, `student.create|update|deactivate|import|qr_rotate`, `seating.create|apply_template|save_layout`, `session.cancel|reopen`.
- `summary` chỉ chứa **trước/sau** của trạng thái, lý do, tên em, số lượng — **không bao giờ** chứa `qr_token`, SĐT đầy đủ (che 4 số cuối) hay payload thẻ.
- Ghi **trong cùng transaction** với thay đổi. **Lượt quét không ghi thêm** (đã có `attendance_scans`, giữ nguyên độ trễ quét); trang nhật ký hợp nhất hai nguồn khi hiển thị.
- Trang `/lop/[classId]/nhat-ky`: lọc theo ngày/buổi/loại, phân trang (50/dòng), mỗi dòng "Ai · lúc nào · làm gì · trước → sau". Quyền đọc = người đọc được lớp. Giữ 12 tháng (dọn theo lịch, mục 4).
- Ràng buộc: thêm ≤1 INSERT nhỏ cho mỗi thao tác thủ công; thao tác hàng loạt chỉ ghi **một** dòng tổng hợp (kèm số em), không mỗi em một dòng.

## 3. Cuối năm: lên lớp, báo cáo học kỳ (P3)

- **Năm học mới** (trưởng khối): tạo `school_years` + 2 `terms` mới (mặc định ngày theo năm trước, sửa được). Buổi cũ giữ nguyên (lưu trữ).
- **Lên lớp**: màn hình theo khối — với mỗi lớp nguồn chọn lớp đích (cùng khối năm sau hoặc khối kế tiếp), chọn em được lên (mặc định tất cả), xem trước, xác nhận. Cơ chế đề xuất: **chuyển** `class_id` của em sang lớp đích (không sao chép). Nhờ vậy thẻ QR in sẵn vẫn dùng được và lịch sử đi theo em; điểm danh năm cũ vẫn nằm ở `sessions` của lớp cũ và trang hồ sơ em tra được theo `student_id`. Phải rà các truy vấn đang giả định "em thuộc đúng lớp của buổi" (thống kê, quét, sơ đồ: xoá chỗ ngồi của em khi chuyển lớp) và có test. Làm trong một transaction, có hoàn tác trong 24 giờ. Phương án thay thế (sao chép, thẻ mới) ở câu hỏi mục 7.
- **Báo cáo học kỳ**: mỗi lớp/học kỳ xuất Excel (đã có đường xuất) + PDF in A4 (bảng chuyên cần từng em: có mặt/muộn/vắng CP/vắng KP, %, cảnh báo) và tổng hợp theo khối cho trưởng khối.
- Quyền: chỉ trưởng khối (và quản trị hiện có) thao tác năm học/lên lớp; có nhật ký (mục 2).

## 4. Nhắc việc + thông báo (P4)

- Thêm `classes.meets_on` (thứ trong tuần) và `classes.meets_at` (giờ bắt đầu), sửa trong trang lớp (mặc định trống = không nhắc).
- Web Push (VAPID): bảng `push_subscriptions(user_id, endpoint, p256dh, auth, created_at)`; service worker `sw.js` chỉ cho push (không cache dữ liệu điểm danh); nút "Bật thông báo" ở Tài khoản, **xin quyền chỉ khi người dùng bấm**. iPhone: chỉ hoạt động khi app đã **Thêm vào Màn hình chính** (iOS 16.4+) — app hướng dẫn tại chỗ.
- Loại thông báo: (a) nhắc GLV mở/đóng buổi: 30 phút sau giờ bắt đầu nếu buổi hôm nay chưa có dấu điểm danh nào; (b) báo trưởng khối khi một em vừa chạm ngưỡng cảnh báo (tối đa 1 lần/em/học kỳ); (c) nhắc GLV còn lượt quét chưa gửi khi mở lại app (không cần push).
- Gửi bằng **tác vụ định kỳ** (Vercel Cron, mỗi 10 phút) gọi route `/api/cron/nhac-viec` bảo vệ bằng `CRON_SECRET`; idempotent (bảng `notification_log` khoá theo loại+đối tượng+ngày); endpoint hết hạn (410) thì xoá đăng ký. Nội dung không chứa tên em đầy đủ khi khoá màn hình ("Có 1 em đạt ngưỡng cảnh báo ở Lớp A").
- Bí mật: `VAPID_PRIVATE_KEY`, `CRON_SECRET` chỉ ở biến môi trường; không commit.

## 5. Bản iPhone (PWA) + triển khai (P5)

- **Không** làm app native (không có Mac/Xcode/Apple Developer). Người dùng mở link Safari → Chia sẻ → "Thêm vào Màn hình chính".
- Chuẩn bị cho iOS: `viewport-fit=cover` + `env(safe-area-inset-*)` cho thanh dưới/nút "Xong"; `apple-touch-icon` 180px + splash; `apple-mobile-web-app-capable/title/status-bar-style`; `display: standalone`; chặn zoom hai ngón/double-tap ở màn quét; kiểm tra **cử chỉ vuốt-quay-lại của iOS** với guard lịch sử đã có (Task 23) ở chế độ standalone; Wake Lock/camera ở standalone (iOS 16.4+) — nếu không có thì tụt cấp êm (đã feature-detect). iOS hỏi quyền camera mỗi lần mở app: ghi trong hướng dẫn.
- Hạ tầng: Vercel (Node, Fluid Compute) + Postgres hosted (Neon/Supabase qua Marketplace) **cùng vùng** (ưu tiên Singapore `sin1`) để độ trễ quét thấp; biến `DATABASE_URL`, `AUTH_SECRET` (≥32 ký tự), `VAPID_*`, `CRON_SECRET`; `NEXT_PUBLIC_E2E_SCAN_BRIDGE` không đặt. Migration chạy qua bước deploy có kiểm soát (`pnpm db:migrate` từ máy/CI, không tự chạy khi build).
- Tôi **không có tài khoản của bạn**: phần tạo dự án Vercel/DB, nhập biến môi trường và bấm deploy là việc của bạn; tôi chuẩn bị cấu hình (`vercel.ts`/`vercel.json`, health check, script preflight, tài liệu từng bước) và kiểm tra bản build production cục bộ. Đo độ trễ thật trên hạ tầng của bạn sau khi deploy (`pnpm bench:scan`).
- Bảo mật: HTTPS bắt buộc; thêm CSP + Permissions-Policy (camera=(self)) — CSP cần `'wasm-unsafe-eval'` cho `zxing_reader.wasm`; HSTS đã có; giới hạn tần suất dùng bộ nhớ theo instance (ghi rõ; nâng lên kho dùng chung nếu cần).

## 6. Thứ tự và phạm vi

P1 → P2 → P3 → P4 → P5 (P5 dùng được sớm: có thể triển khai ngay sau P1 để dùng thử trên iPhone, rồi tiếp tục). Mỗi mục là 2–4 task, có review từng task như Mốc 7–8. Ước lượng: khoảng 14–16 task.

**Ngoài phạm vi**: app native/App Store, cổng phụ huynh, điểm kiểm tra/thi, ảnh học sinh, chế độ tối, offline thật cho bảng điểm danh (chạm trên bảng vẫn cần mạng; quét QR đã chịu được mất mạng), nhắn tin tự động tới phụ huynh (chỉ mở sẵn Zalo/SMS/Gọi).

## 7. Quyết định đã chốt (12/10/2026)

1. Lên lớp: **chuyển** em (giữ thẻ QR, lịch sử đi theo em).
2. Giờ/ngày học: để trống được (không nhắc nếu trống).
3. Trưởng khối **có** nhận push khi em chạm ngưỡng (học vắng và đi lễ).
4. Vùng triển khai: Singapore (`sin1`) và Postgres cùng vùng.
5. Đi lễ: ghi cả hai cách; tính riêng, ngưỡng riêng (mặc định 2 tuần/học kỳ, cấu hình theo khối).
