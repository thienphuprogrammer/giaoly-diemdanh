# Danh sách kiểm phát hành: QR và độ tin cậy

> Bản lưu của đợt QR (2026-10-12, trước Mốc 9). Kết quả mới nhất và việc của chủ dự án: [`release-checklist-moc9.md`](release-checklist-moc9.md). Một số mục "chưa làm" ở mục 3 đã có ở Mốc 9 (CSP, nhắc việc tự động); endpoint `ket-qua` đã bị xoá ở Mốc 9.

Ngày chạy: 2026-10-12. Nhánh `feat/qr-attendance`, nền `49f4c61` cộng đợt sửa sau review cuối (lịch sử Xong, hàng chờ trên máy chặn "Đánh vắng", máy quét buổi nghỉ lễ, gia cố). Các số dưới đây là lần chạy lại thật sau đợt sửa đó.

Quy ước: `[x]` = đã chạy thật ở bước này, kèm kết quả; `[ ]` = chưa làm. Mục **"việc của chủ dự án"** cần điện thoại thật, hạ tầng thật hoặc dữ liệu thật mà môi trường phát triển không có: không được tích trước khi tự tay kiểm.

## 1. Cổng tự động (đã chạy lại ở bước này)

- [x] `pnpm test:cov`: 63 file, **554 test đạt**. Coverage: statements 94.00%, branches 88.45%, functions 97.28%, lines 97.32% (ngưỡng ép: 80/70/80/80, đạt).
- [x] `pnpm exec tsc --noEmit`: sạch (chạy trong worktree sạch; ở checkout chính chỉ có lỗi cũ trong `.next/types` do dev server sinh ra, không phải mã nguồn).
- [x] `pnpm lint`: sạch.
- [x] `pnpm build`: thành công (worktree sạch, cài offline).
- [x] `pnpm test:pg` (Postgres 16 thật cục bộ, database `*_conc` riêng): **8/8 đạt** (các tình huống đua: quét trùng, quét khác sự kiện, hoàn tác trùng/khác id, hoàn tác đua quét và đua sửa tay).
- [x] `pnpm test:e2e` (Postgres 16 cục bộ, chạy trong worktree sạch): **86/86 đạt** ở hai viewport (phone-375 và tablet-768, mỗi viewport 43 kịch bản), gồm in thẻ, quét liên tục, đi muộn, thẻ sai lớp, xác nhận em vắng + hoàn tác, mất phản hồi và gửi lại, hàng chờ bền vững sau tải lại, hết phiên rồi đăng nhập lại, Back guard, đánh vắng em còn lại, tìm theo tên, người chỉ đọc nhận 404; mới: bảng → Quét QR → Xong lùi về bảng có dữ liệu mới và Back tiếp về "Lớp của tôi" (đã xác nhận test đỏ với cách `replace` cũ), bảng khóa "Đánh vắng" và nhắc khi máy còn lượt quét chưa gửi, máy quét buổi nghỉ lễ (không camera, quét/chọn tên bị từ chối, không gửi gì), phím mũi tên trong nhóm chế độ quét, header `Permissions-Policy`.
- [x] Test cấu trúc xác thực `src/test/auth-guard.test.ts` + `auth-guard-check.test.ts` nằm trong 554 test ở trên. Đã xác nhận nó **bắt** một server action và một route không xác thực chèn tạm vào `src/app/tmp-guard/` (hai test đỏ), rồi xóa tệp tạm (test xanh lại).
- [x] Rà soát token: `grep -rn "qrToken\|qr_token" src --include=*.ts --include=*.tsx | grep -v "\.test\."` chỉ ra `db/schema.ts`, `db/queries/qr-cards.ts`, `db/queries/scan.ts`, `server/services/qr-cards.ts` và một dòng chú thích trong `db/queries/students.ts` (nói rằng cột này cố ý vắng). Không có chỗ nào ngoài tập cho phép. Migration `drizzle/0002_*.sql` nằm ngoài `src`.
- [x] Cầu nối E2E: `NEXT_PUBLIC_E2E_SCAN_BRIDGE` chỉ được đặt trong `playwright.config.ts` (E2E chạy `next dev`). Điều kiện `=== "1" && NODE_ENV !== "production"` bị loại lúc biên dịch: `grep -rl __scanFeed .next/static` sau `pnpm build` cho **0 tệp**, kể cả khi build với `NEXT_PUBLIC_E2E_SCAN_BRIDGE=1` (đã thử cả hai). `src/test/scan-bridge-gate.test.ts` giữ nguyên dạng điều kiện. Quy tắc vận hành vẫn là không đặt biến này trên Vercel/production.
- [x] Header `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (test đơn vị trên `next.config.ts` + E2E đọc header thật). Chưa có CSP (ghi nhận ở mục 3).
- [x] `barcode-detector` ghim đúng phiên bản `3.2.2` (lockfile cập nhật offline); `src/test/qr-wasm-integrity.test.ts` so sha256 `public/zxing_reader.wasm` với `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` (khớp).
- [ ] `pnpm bench:scan` trên môi trường thật: **chưa chạy lại ở bước này** (số đo cục bộ cũ ở `qr-baseline.md` mục 5; chỉ có giá trị tham khảo vì độ trễ mạng gần bằng 0).

## 2. Việc của chủ dự án (chưa làm, bắt buộc tự kiểm trước khi dùng thật)

- [ ] **Thử trên điện thoại thật, Android Chrome và iPhone Safari**: quét 10 thẻ in thật, gồm ánh sáng yếu, thẻ nghiêng, thẻ ép plastic bóng. (việc của chủ dự án)
- [ ] **Thẻ in ra quét được ở khoảng cách tay**: ghi lại cỡ thẻ/độ phân giải đã thử. (việc của chủ dự án)
- [ ] **Wake Lock và khởi động lại camera sau khi khóa máy**: khóa/mở khóa, chuyển app rồi quay lại trên cả hai hệ điều hành; màn hình không tắt khi đang quét; camera tự mở lại. (việc của chủ dự án)
- [ ] **Quyền camera**: kiểm các bước hướng dẫn trong README (iPhone Safari, Android Chrome) có đúng với phiên bản máy đang dùng. (việc của chủ dự án)
- [ ] **Đo độ trễ trên hạ tầng thật, app và database cùng vùng**, theo phương pháp trong `docs/superpowers/qr-baseline.md` (`pnpm bench:scan`, nhớ giới hạn 180 lượt/phút nên chờ giữa các lần chạy); điền bảng "chưa đo" và xác nhận p95 chấp nhận được. (việc của chủ dự án)
- [ ] **Chạy migration trên bản sao dữ liệu thật**: mọi em cũ có `qr_token` khác nhau, không lỗi, rồi mới áp lên production. (việc của chủ dự án)
- [ ] **Xem trước khi in (print preview)**: trang in thẻ 10 thẻ/trang A4, không còn thanh điều hướng, không cắt thẻ. (việc của chủ dự án)
- [ ] **404 với trưởng khối chỉ đọc**: trưởng khối không được gán lớp mở trang in thẻ và màn quét phải thấy 404 (E2E đã kiểm, cần xem tay trên bản triển khai). (việc của chủ dự án)
- [ ] **"Xem nguồn trang"**: các trang danh sách thiếu nhi, điểm danh, sơ đồ, thống kê không chứa chuỗi `dd1.` (tiền tố mã thẻ). (việc của chủ dự án)
- [ ] **Chạy `security-reviewer` và `code-reviewer` lần cuối trên toàn bộ diff nhánh** (bộ điều phối chạy ở bước kế tiếp, không thuộc bước này).
- [ ] Đặt `AUTH_SECRET` (>= 32 ký tự) và `DATABASE_URL` trên môi trường triển khai; xác nhận không đặt `NEXT_PUBLIC_E2E_SCAN_BRIDGE`. (việc của chủ dự án)

### Triển khai Vercel + Postgres (hướng dẫn: `docs/deploy-vercel-ios.md`)

- [ ] Tạo Postgres ở Singapore (Neon hoặc Supabase), cùng vùng với Vercel `sin1`. (việc của chủ dự án)
- [ ] Tạo dự án Vercel từ GitHub, nhập `DATABASE_URL`, `AUTH_SECRET` (>= 32 ký tự, `openssl rand -base64 48`), và `DB_PREPARE=false` nếu dùng pooler giao dịch; không đặt `NEXT_PUBLIC_E2E_SCAN_BRIDGE`. (việc của chủ dự án)
- [ ] Sao lưu rồi chạy `pnpm db:migrate` từ máy bạn; `pnpm preflight --prod` báo "Sẵn sàng". (việc của chủ dự án)
- [ ] Tạo tài khoản trưởng khối đầu tiên bằng `pnpm seed`. (việc của chủ dự án)
- [ ] Deploy, `GET /api/health` trả `{"ok":true,"db":true,...}`, đăng nhập được. (việc của chủ dự án)
- [ ] iPhone: Thêm vào Màn hình chính, đăng nhập, camera hoạt động ở chế độ app. (việc của chủ dự án)
- [ ] Đo `pnpm bench:scan` trên hạ tầng thật (database `e2e` riêng, xem mục 7 của hướng dẫn) và điền bảng hosted trong `qr-baseline.md`. (việc của chủ dự án)
- [ ] Bật sao lưu Postgres (PITR/hằng ngày) và thử khôi phục một lần. (việc của chủ dự án)
- [ ] Xác nhận loại gói Vercel phù hợp (Hobby chỉ cho mục đích phi thương mại). (việc của chủ dự án)

## 3. Chưa làm (ghi nhận rõ, không phải lỗi sót)

- **Ghi điểm danh ngoại tuyến thật trên máy chủ**: hàng chờ trên thiết bị chỉ giữ lượt quét tối đa 3 ngày và chỉ gửi được khi có mạng; thao tác trên bảng điểm danh cần kết nối ngay lúc bấm.
- **Nhắc muộn tự động** theo giờ bắt đầu lớp.
- **Thu hồi phiên đăng nhập** (đăng xuất/đặt lại mật khẩu không vô hiệu hóa cookie đã cấp).
- **Bộ giới hạn tốc độ dùng chung/phân tán** (hiện nằm trong bộ nhớ từng instance).
- **Phiên bản phiên theo từng người dùng** (session version) để thu hồi phiên.
- Không có test thành phần (component) cho các hook quét; chỉ có logic thuần và E2E.
- **CSP**: chưa đặt Content-Security-Policy (chỉ có các header ở mục 1).
- **Nút nhanh trang chủ** vẫn hiện "Quét QR" cho buổi hôm nay đã đánh dấu nghỉ lễ (trang chủ không đọc buổi); máy quét tự báo nghỉ lễ và từ chối.
- Giữ nguyên (đã cân nhắc, không đổi ở đợt này): endpoint kết quả quét (đã xoá ở Mốc 9), tách các hàm dài, đặt namespace cho `batchId`, thu hồi phiên.
