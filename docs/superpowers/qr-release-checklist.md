# Danh sách kiểm phát hành: QR và độ tin cậy

Ngày chạy: 2026-10-12. Nhánh `feat/qr-attendance`, nền `9521311` cộng thay đổi của bước này (test cấu trúc xác thực, README, tài liệu này).

Quy ước: `[x]` = đã chạy thật ở bước này, kèm kết quả; `[ ]` = chưa làm. Mục **"việc của chủ dự án"** cần điện thoại thật, hạ tầng thật hoặc dữ liệu thật mà môi trường phát triển không có: không được tích trước khi tự tay kiểm.

## 1. Cổng tự động (đã chạy lại ở bước này)

- [x] `pnpm test:cov`: 56 file, **525 test đạt**. Coverage: statements 93.87%, branches 88.08%, functions 97.21%, lines 97.26% (ngưỡng ép: 80/70/80/80, đạt).
- [x] `pnpm exec tsc --noEmit`: sạch (chạy trong worktree sạch; ở checkout chính chỉ có lỗi cũ trong `.next/types` do dev server sinh ra, không phải mã nguồn).
- [x] `pnpm lint`: sạch.
- [x] `pnpm build`: thành công (worktree sạch, cài offline).
- [x] `pnpm test:pg` (Postgres 16 thật cục bộ, database `*_conc` riêng): **8/8 đạt** (các tình huống đua: quét trùng, quét khác sự kiện, hoàn tác trùng/khác id, hoàn tác đua quét và đua sửa tay).
- [x] `pnpm test:e2e` (Postgres 16 cục bộ, build trong worktree sạch): **78/78 đạt** ở hai viewport (phone-375 và tablet-768, mỗi viewport 39 kịch bản), gồm in thẻ, quét liên tục, đi muộn, thẻ sai lớp, xác nhận em vắng + hoàn tác, mất phản hồi và gửi lại, hàng chờ bền vững sau tải lại, hết phiên rồi đăng nhập lại, Back guard, đánh vắng em còn lại, tìm theo tên, người chỉ đọc nhận 404.
- [x] Test cấu trúc xác thực `src/test/auth-guard.test.ts` + `auth-guard-check.test.ts` nằm trong 525 test ở trên. Đã xác nhận nó **bắt** một server action và một route không xác thực chèn tạm vào `src/app/tmp-guard/` (hai test đỏ), rồi xóa tệp tạm (test xanh lại).
- [x] Rà soát token: `grep -rn "qrToken\|qr_token" src --include=*.ts --include=*.tsx | grep -v "\.test\."` chỉ ra `db/schema.ts`, `db/queries/qr-cards.ts`, `db/queries/scan.ts`, `server/services/qr-cards.ts` và một dòng chú thích trong `db/queries/students.ts` (nói rằng cột này cố ý vắng). Không có chỗ nào ngoài tập cho phép. Migration `drizzle/0002_*.sql` nằm ngoài `src`.
- [x] Cầu nối E2E: `NEXT_PUBLIC_E2E_SCAN_BRIDGE` chỉ được đặt trong `playwright.config.ts`. Bản build thường **vẫn chứa** mã `__scanFeed` trong bundle client (đã thấy bằng `grep -r __scanFeed .next/static`), nhưng nó vô hiệu trừ khi biến được đặt lúc build. Quy tắc vận hành: không bao giờ đặt biến này trên Vercel/production.
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

## 3. Chưa làm (ghi nhận rõ, không phải lỗi sót)

- **Ghi điểm danh ngoại tuyến thật trên máy chủ**: hàng chờ trên thiết bị chỉ giữ lượt quét tối đa 3 ngày và chỉ gửi được khi có mạng; thao tác trên bảng điểm danh cần kết nối ngay lúc bấm.
- **Nhắc muộn tự động** theo giờ bắt đầu lớp.
- **Thu hồi phiên đăng nhập** (đăng xuất/đặt lại mật khẩu không vô hiệu hóa cookie đã cấp).
- **Bộ giới hạn tốc độ dùng chung/phân tán** (hiện nằm trong bộ nhớ từng instance).
- **Phiên bản phiên theo từng người dùng** (session version) để thu hồi phiên.
- Không có test thành phần (component) cho các hook quét; chỉ có logic thuần và E2E.
