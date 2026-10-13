# Admin và lớp theo năm học — production 13/10/2026

Production: https://giaoly-diemdanh.vercel.app

Deployment READY: `dpl_2oP4e2Uj6Vy8yvqiLhVbxAbWfMNV`. Build tại Singapore (sin1), Node.js 24; tạo bản production chưa chuyển tên miền, kiểm tra rồi promote. Nguồn là snapshot mã hiện tại trong workspace, chưa commit/push; snapshot SHA-256 `2b5d1f4e223727b022328cf6202bce20149a3d84fd69c2ce67811561e70c903c`.

Người dùng đã cho phép sao lưu database production xuống máy. Bản sao được bảo vệ tại `/tmp/diemdanh-production-release/pre-admin.backup`; đã khôi phục vào PostgreSQL 18 riêng và chạy thử migration. Database thử và cấu hình kết nối tạm đã xóa sau khi kiểm chứng.

Migration `0010_password_changed_at` và `0011_admin_annual_classes` đã áp dụng; ledger hiện có 12 migration. Tài khoản hiện có được giữ nguyên qua migration. Production trước triển khai có 1 tài khoản, 1 khối, 1 năm học và 2 học kỳ, không có lớp/thiếu nhi/điểm danh/lượt lên lớp. Không nhập dữ liệu mẫu.

Đã tạo admin riêng `admin@giaoly.local` với mật khẩu ngẫu nhiên, bàn giao trong tệp riêng được bảo vệ, không lưu mật khẩu vào repo. Sau bootstrap có 2 tài khoản và 1 admin hoạt động.

Kiểm chứng website thật: health HTTP 200 với database hoạt động; đăng nhập admin thành công; trang quản trị, lớp và năm học mở được; năm học cũ còn nguyên; khách chưa đăng nhập bị chuyển về login; không tràn ở 375/768/1280/1440px; không có lỗi JavaScript hoặc CSP trong lượt kiểm tra.

Không tải log runtime production về máy: automatic approval review chặn vì chưa có phép riêng cho dữ liệu log. Không dùng kết quả kiểm tra trình duyệt để tuyên bố toàn bộ log production không có lỗi.

Sau khi sử dụng quyền admin/khóa tài khoản, không rollback riêng ứng dụng về bản cũ: bản cũ bỏ qua `isActive`/`sessionVersion` và phạm vi năm của lớp. Sửa và triển khai tiếp trên schema hiện tại nếu cần.
