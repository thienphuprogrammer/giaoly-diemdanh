# UI/UX và responsive cho laptop, PC

Ngày: 12/10/2026. Phạm vi: cải thiện giao diện hiện có cho cả giáo lý viên và trưởng khối; giữ nghiệp vụ, quyền truy cập và các đường dẫn.

## Cơ sở thiết kế

Mã hiện tại giới hạn mọi trang ở 768px và luôn dùng thanh điều hướng dưới. Bảng điểm danh đặt toàn bộ điều khiển trước danh sách; quản lý khối hiển thị nhiều biểu mẫu cùng lúc; danh sách thiếu nhi chưa có tìm kiếm. Các nhận xét cũ về việc trang chủ cần hai chạm hoặc trạng thái chỉ chọn được bằng nhấn giữ đã lỗi thời: trang chủ đã có nút nhanh, sơ đồ đã có nút lựa chọn khác. Khối đi lễ mặc định thu gọn.

## Hướng triển khai

- Tham chiếu mới: ảnh phần mềm quản lý giáo dục do người dùng cung cấp; ưu tiên hàng dữ liệu thẳng cột, component gọn và màu nhấn có mục đích.
- Màu: nền #f8fafc, thẻ #ffffff, chữ #243247, chữ phụ #4f5f75, thao tác #345b99, thanh đầu #283f6a, viền #d8dfe9. Trạng thái giữ màu ngữ nghĩa hiện có.
- Chữ: Be Vietnam Pro cho cả nội dung, tiêu đề và điều khiển, trọng lượng 400/500/600. Nút bo 6px, panel bo 8px; hover đổi màu, giữ vị trí ổn định.
- Dưới 1024px: thanh dưới, nội dung một cột trên điện thoại và hai cột khi đủ chỗ trên tablet.
- Từ 1024px: thanh đầu 64px, thanh trái 240px, tên sản phẩm và vai trò; nội dung mở rộng theo màn hình, giới hạn để vẫn đọc dễ trên PC lớn. Header lớp dính dưới thanh đầu.
- Từ 1280px: màn điểm danh chia vùng danh sách/sơ đồ và vùng thao tác buổi; trang lớp chia thao tác và lịch sử; lớp ở trang chủ hiển thị thành hàng có hành động nhanh.
- Danh sách thiếu nhi và tổng quan khối có các cột dữ liệu thẳng hàng từ 1024px; điện thoại vẫn xếp thông tin thành dòng dễ đọc.
- Tìm thiếu nhi có nhãn rõ, lọc ngay trong danh sách đã được phép xem. Không bổ sung dữ liệu hoặc gửi tìm kiếm ra dịch vụ ngoài.
- Quản lý khối ưu tiên tổng quan và phân công; biểu mẫu ít dùng được gom dưới nhóm có thể mở/đóng.
- Biểu mẫu cá nhân giữ chiều rộng vừa đọc, bảng báo cáo tận dụng vùng nội dung rộng.
- Hộp thoại gốc HTML nằm giữa màn hình laptop/PC, giữ kiểu bảng trượt trên điện thoại; nền không tương tác, hỗ trợ Escape và trả focus về nơi mở. Khóa cuộn dùng chung để đóng nhiều hộp không khóa trang đích.
- Khi thao tác làm một dòng biến mất khỏi bộ lọc, focus trở về ô tìm kiếm để tiếp tục bằng bàn phím.

Bố cục:

```text
Điện thoại/tablet       Laptop / PC
┌─────────────────┐    ┌────────────┬──────────────────────────────┐
│ Nội dung        │    │ Giáo lý    │ Tiêu đề và ngữ cảnh          │
│                 │    │ Điều hướng├─────────────────┬────────────┤
│                 │    │ chính      │ Danh sách / bảng│ Thao tác   │
├─────────────────┤    │            │                 │ / lịch sử │
│ Điều hướng dưới │    │ Tài khoản │                 │            │
└─────────────────┘    └────────────┴─────────────────┴────────────┘
```

Ưu tiên tính quen thuộc và không gian làm việc cho lớp giáo lý. Không thay tên chức năng hoặc quy tắc đổi trạng thái khi chưa có bằng chứng cần thay. Kiểm tra bố cục, cuộn ngang, quyền chỉ xem, lưu/hoàn tác, điều hướng và in báo cáo trên trình duyệt thật trước khi bàn giao.

## Kết quả kiểm tra

- Build production, TypeScript và lint đạt. Hai lượt review mã không còn vấn đề cần sửa.
- 1.682 unit test trong 133 suite đạt khi giới hạn số tiến trình. Lượt mặc định trước đó gặp timeout do tải máy; lượt chạy lại đã hoàn tất xanh.
- 24 E2E đạt trên 4 cấu hình điện thoại/tablet/laptop/PC. Kiểm tra các chiều rộng 375, 768, 1024, 1280, 1440, 1920px; không có cuộn ngang trang chủ, bảng điểm danh hoặc danh sách thiếu nhi.
- E2E xác nhận: lọc không thay phạm vi thao tác cả lớp; focus trở về tìm kiếm khi dòng biến mất; Escape/trả focus; rời trang khi hai dialog đang mở vẫn khôi phục cuộn; quyền chỉ xem; bản in không có điều hướng hoặc khoảng trống sidebar.
- Đã xem ảnh thật của trang chủ, thiếu nhi và khối; không có lỗi JavaScript trong lượt chụp cuối.
- Bản xem thử tại http://localhost:3200 dùng database mẫu độc lập. Thông tin đăng nhập không được lưu trong tài liệu dự án. Không deploy production trong tác vụ này.
