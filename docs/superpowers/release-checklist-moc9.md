# Danh sách kiểm phát hành: Mốc 9

(Hồ sơ em, điểm danh đi lễ, nhật ký thay đổi, năm học mới + lên lớp, báo cáo học kỳ, iPhone PWA + CSP, triển khai Vercel, thông báo đẩy + nhắc việc.)

Ngày chạy: 2026-10-12. Nhánh `feat/qr-attendance`, nền `7e4de55` cộng đợt sửa cuối Mốc 9 (nhắc việc chỉ trong học kỳ và lớp còn em, danh sách học kỳ cũ của lớp đích sau lên lớp, `?next=` chặn route xuất của khối, gỡ endpoint `ket-qua`, cổng `REMINDERS_ENABLED`, kiểm PostgreSQL ≥ 15 trong preflight). Bản trước (đợt QR): [`qr-release-checklist.md`](qr-release-checklist.md).

Quy ước: `[x]` = đã chạy thật ở bước này, kèm kết quả; `[ ]` = chưa làm. Mục **(việc của chủ dự án)** cần điện thoại thật, hạ tầng thật hoặc dữ liệu thật: không được tích trước khi tự tay kiểm.

## 1. Cổng tự động (đã chạy thật ở bước này)

Unit/coverage/lint chạy ở checkout chính; `tsc`, build, `test:pg`, E2E và bench chạy trong một worktree tạm sạch (cài `pnpm install` thật, không có `.next` cũ), đã xoá sau khi chạy. Dev server của chủ dự án (:3200) không bị đụng tới.

- [x] `pnpm test:cov`: 127 file, **1636 test đạt**. Coverage: statements 96,51%, branches 92,05%, functions 98,36%, lines 98,38% (ngưỡng ép 80/70/80/80: đạt).
- [x] `pnpm exec tsc --noEmit` (worktree sạch): **sạch**. Ở checkout chính chỉ còn lỗi cũ trong `.next/types` do dev server sinh (trỏ tới trang/route đã xoá), không phải mã nguồn: muốn kiểm ở checkout chính thì xoá `.next/types` hoặc dùng worktree sạch.
- [x] `pnpm exec eslint --ignore-pattern ".worktrees/**"`: **sạch** (0 lỗi, 0 cảnh báo).
- [x] `pnpm build` (worktree sạch): **thành công**. `grep -rl __scanFeed .next/static`: **0 tệp** (cầu nối E2E không có trong bản build).
- [x] `pnpm test:pg` (Postgres 16 thật, database `*_conc` riêng): **11/11 đạt** (đua quét/hoàn tác, lên lớp đồng thời).
- [x] `pnpm test:e2e` (Postgres 16 cục bộ, `next dev`, hai viewport phone-375 và tablet-768): **194 kịch bản: 189 đạt, 5 bỏ qua có chủ đích, 0 lỗi**. Lần chạy đầu phát hiện kịch bản nhắc việc dùng Lớp L không có em (đúng hành vi mới: lớp trống không bị nhắc); kịch bản được sửa để kiểm cả hai chiều (lớp trống không nhắc, thêm một em thì nhắc), chạy lại toàn bộ: xanh.
- [x] `pnpm audit --prod`: **1 moderate đã biết**: `uuid < 11.1.1` qua `exceljs` (GHSA-w5hq-g745-h8pq, thiếu kiểm biên khi truyền `buf` cho v3/v5/v6). App không gọi `uuid` với `buf` (exceljs chỉ dùng v4 sinh id), nên không khai thác được; chờ exceljs cập nhật.
- [x] `pnpm preflight` trên Postgres E2E: `[ĐẠT] PostgreSQL 16.x (cần ≥ 15)`, migration 10/10. Máy chủ < 15 cho `[LỖI]` (test đơn vị).
- [x] Rà `qr_token`: ngoài `db/schema.ts`, `db/queries/qr-cards.ts`, `db/queries/scan.ts`, `server/services/qr-cards.ts` chỉ có dòng chú thích (students, stats, reminders, promotions, term-report, audit events). Rà SĐT: `parentPhone` chỉ ở form sửa của người có quyền ghi, hồ sơ/Cần chú ý (dựng liên kết ở máy chủ) và `StudentRow` của danh sách (người đọc được lớp; đã biết từ Task 27). Không có SĐT/mã thẻ trong thông báo đẩy, nhật ký (SĐT che), báo cáo.
- [x] Test cấu trúc xác thực (`auth-guard.test.ts`, `auth-guard-check.test.ts`) xanh sau khi xoá route `/api/diem-danh/ket-qua`.
- [x] `pnpm bench:scan` (server production `next build` + `next start -p 3100`, Postgres cục bộ, `AUTH_SECRET` sinh lúc chạy, không lưu), so với số cơ sở ở `qr-baseline.md` mục 5:

  | Chỉ số (ms) | Lần 1 | Lần 2 | Cơ sở (3 lần) |
  |---|---|---|---|
  | Tuần tự p50 | 8.4 | 6.1 | 5.0–5.4 |
  | Tuần tự p95 | 69 | 23.2 | 8.2–17.7 |
  | Tuần tự max | 76.2 | 71.7 | 9.2–19.5 |
  | 5 song song p50 | 12.9 | 11.1 | 10.3–18.1 |
  | 5 song song p95 | 23.7 | 13.9 | 14.0–28.8 |
  | 30 lượt song song, tổng | 95 | 70 | 69–108 |

  p50 tăng khoảng 1–3 ms so với cơ sở (Mốc 9 thêm cột `sessions.kind` vào truy vấn ngữ cảnh và một INSERT nhật ký cho thao tác tay, đường quét không thêm truy vấn); p95/max tuần tự dao động do vài lượt đầu nguội và máy dùng chung (đang chạy nhiều container khác). Vẫn dưới xa ngưỡng 100 ms. Đây là số cục bộ (vòng mạng ≈ 0), **không** thay cho đo trên hạ tầng thật.

## 2. Việc của chủ dự án (chưa làm, bắt buộc tự kiểm trước khi dùng thật)

### Triển khai lần đầu (hướng dẫn: `docs/deploy-vercel-ios.md`)

- [ ] Xác nhận database là **PostgreSQL ≥ 15** (`pnpm preflight --prod` dòng "PostgreSQL …"; Neon/Supabase mặc định đã đạt).
- [ ] **Sao lưu database ngay trước khi migrate** (PITR hoặc `pg_dump`) và thử khôi phục một lần vào database trống.
- [ ] **Chạy migration trên bản sao dữ liệu thật** trước (0003–0009 của Mốc 9: đi lễ, ngưỡng đi lễ, nhật ký, lên lớp, lịch học, thông báo đẩy): không lỗi, số liệu cũ giữ nguyên; rồi mới `pnpm db:migrate` lên production.
- [ ] Đặt biến trên Vercel: `DATABASE_URL`, `AUTH_SECRET`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (`pnpm push:keys`), `CRON_SECRET` (`openssl rand -base64 48`); **không** đặt `NEXT_PUBLIC_E2E_SCAN_BRIDGE`, `PUSH_DRY_RUN`. `pnpm preflight --prod` báo "Sẵn sàng".
- [ ] Deploy; `GET /api/health` trả `{"ok":true,"db":true,…}`; đăng nhập được.
- [ ] **Kiểm CSP trên bản production** (README, mục "Kiểm tra CSP trên bản production"): không có lỗi CSP trong Console ở đăng nhập, bảng điểm danh, máy quét, Tài khoản, báo cáo in.
- [ ] **Quyết định iOS ≤ 15**: hỏi đời máy/phiên bản iOS của các GLV. Có máy iOS 15 trở xuống cần quét QR thì build với `CSP_ALLOW_UNSAFE_EVAL=1` (CSP yếu hơn); không thì để tắt.
- [ ] **Nhắc việc**: đặt secret GitHub `APP_URL`, `CRON_SECRET` → bấm "Run workflow" một lần (xanh, trả số đếm) → đặt repository variable **`REMINDERS_ENABLED=true`**. Repo riêng tư: đổi lịch sang 30 phút hoặc dùng cron-job.org (phút Actions). Hoặc dùng bộ gọi ngoài/Vercel Pro.
- [ ] Biết rằng lần chạy nhắc việc đầu tiên gửi **một** thông báo gộp cho các cảnh báo đang có tới mỗi trưởng khối đã bật thông báo.
- [ ] Xác nhận loại gói Vercel phù hợp (Hobby chỉ cho mục đích phi thương mại; cron Hobby chỉ mỗi ngày một lần).

### Điện thoại thật (iPhone và Android; danh sách chi tiết: `docs/ios-checklist.md`)

- [ ] **Cài PWA**: Safari → Thêm vào Màn hình chính → mở từ biểu tượng → đăng nhập lại; Android Chrome → Cài đặt ứng dụng.
- [ ] **Camera trong app đã cài (standalone)**: hỏi quyền, hình trong khung, quét 10 thẻ in thật (ánh sáng yếu, thẻ nghiêng, ép plastic bóng), cả máy quét buổi học và **máy quét đi lễ** tại nhà thờ.
- [ ] **Wake Lock**: để yên màn quét quá thời gian tự khoá: màn hình không tắt (iOS 16.4+); khoá/mở máy → camera tự mở lại.
- [ ] **Vuốt quay lại khi còn lượt chưa gửi** (`docs/ios-checklist.md` mục 4): bảng hỏi hiện, lượt không mất.
- [ ] **Thông báo đẩy đầu-cuối**: Tài khoản → Bật thông báo (iPhone: app đã cài, iOS 16.4+) → **Gửi thử** tới được máy (cả khi khoá máy), chạm mở app; Tắt thông báo không tự bật lại; đăng xuất gỡ đăng ký.
- [ ] **Nhắc việc thật qua GitHub Actions**: đặt lịch học một lớp thử (giờ bắt đầu cách hiện tại ~40 phút, trong học kỳ, lớp có em) → đợi một lần chạy theo lịch (hoặc Run workflow) → GLV nhận "Chưa điểm danh"; lần chạy sau không gửi trùng. Lớp không còn em / ngày ngoài học kỳ thì không nhận.
- [ ] Mục **Đi lễ** trên bảng (bốn lựa chọn, "Cả lớp đi lễ" + Hoàn tác), hồ sơ em (Gọi/Zalo/SMS mở đúng app), báo cáo học kỳ **In / Lưu PDF** trên điện thoại.

### Hiệu năng và dữ liệu thật

- [ ] **Độ trễ trên hạ tầng thật, app và database cùng vùng** (`sin1` + Singapore): `pnpm bench:seed` rồi `pnpm bench:scan` theo `docs/deploy-vercel-ios.md` mục 7 (database `e2e` riêng, không phải database thật); điền bảng hosted trong `qr-baseline.md`; p95 ≤ 100 ms.
- [ ] **Số điện thoại cũ**: lọc các em có số không đúng dạng mới (không có nút liên hệ trên hồ sơ) và sửa trước khi GLV cần sửa thông tin khác của em đó.
- [ ] Trước khi cho lên lớp thật: thử một lượt lên lớp + hoàn tác trên lớp thử, xem thống kê học kỳ cũ của lớp nguồn và lớp đích.

## 3. Chưa làm / giới hạn (ghi nhận rõ, không phải lỗi sót)

- Không có điểm danh ngoại tuyến thật; chạm trên bảng điểm danh và mục Đi lễ cần mạng ngay lúc bấm.
- Bộ giới hạn tốc độ nằm trong bộ nhớ từng instance.
- Đặt lại mật khẩu/đăng xuất không thu hồi phiên đã cấp (trần 90 ngày).
- Cảnh báo vắng lễ không có cho em chưa từng có dòng điểm danh nào ở lớp hiện tại (không có ngày nhập học).
- Nhật ký cấp khối chưa có trang xem; `assignSeat` và quản trị tài khoản không được ghi; `attendance_scans` không bao giờ được dọn; nhật ký chỉ được dọn 365 ngày khi cron chạy.
- CSP của bản production chỉ kiểm tay (E2E chạy `next dev`).
- Đã cân nhắc và để lại: một GET có ghi (mở buổi khi mở trang), giới hạn học kỳ của "lần đầu thấy" trong `massGrid`, số truy vấn của báo cáo khối, đua nhỏ ở trần 10 thiết bị push.
