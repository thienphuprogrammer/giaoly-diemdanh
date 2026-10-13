# Bản nháp UI — Điểm danh Giáo lý

Ngày: 11/10/2026. Phạm vi: phân tích mã giao diện hiện tại và đề xuất thiết kế; chưa thay đổi ứng dụng. Hình dùng dữ liệu minh họa, QR không phải chức năng đang hoạt động. Chưa kiểm tra trực quan các màn hình sau đăng nhập trên ứng dụng chạy thực tế.

## Đánh giá hiện tại

- Nền sáng, chữ tiếng Việt với Be Vietnam Pro và Lexend, nút tối thiểu 44px, phản hồi lỗi và quyền chỉ đọc là nền tảng tốt nên giữ.
- Trang chủ chỉ có thẻ dẫn vào lớp; thêm đường dẫn trực tiếp đến điểm danh hôm nay giúp giảm một bước thường dùng. Quyền chỉ đọc vẫn dẫn vào xem lớp.
- Màn điểm danh xếp tiến độ, nút tất cả có mặt, công tắc nghỉ lễ, bộ chọn sơ đồ/danh sách và chú thích trước hoặc quanh vùng thao tác. Cần giảm phần đầu để thấy các em sớm hơn.
- Công tắc nghỉ lễ tác động toàn buổi nhưng luôn xuất hiện cạnh thao tác thường xuyên. Đưa vào menu buổi, kèm trạng thái rõ ràng sau khi chọn.
- Đổi Checklist thành Danh sách. Thay chữ Có và Vắng KP bằng Có mặt và Vắng không phép ở nơi đủ rộng.
- Sơ đồ hiện dùng tên rút gọn và nút lựa chọn nhỏ 28px. Khi thiết kế lại, đảm bảo vùng chạm lựa chọn tối thiểu 44px, kiểm tra tên trùng và cuộn ngang trên điện thoại.
- Trang desktop giới hạn 768px và dùng điều hướng dưới như điện thoại. Có thể bổ sung vùng làm việc rộng hơn và điều hướng bên trái khi triển khai desktop.

## Hướng thiết kế

Phong cách: tối giản ấm, gần gũi lớp học. Điểm nhận diện: thẻ buổi học xanh lá đậm trên nền giấy sáng. DFII: tác động 4 + phù hợp 5 + khả thi 5 + hiệu năng 5 - rủi ro nhất quán 4 = 15.

Giữ Be Vietnam Pro cho nội dung và Lexend cho tiêu đề khi triển khai. Hình nháp dùng font có sẵn để xem bố cục. Nền #F6F5F0, mặt thẻ #FFFFFF, hành động #205547. Nhịp khoảng cách 8px, lề màn hình 24px, nút tối thiểu 48px. Kiểm tra tương phản từng cặp màu khi triển khai; hình minh họa không thay cho kiểm thử accessibility.

## Ba màn hình đề xuất

1. Lớp của tôi: ngày, lời chào ngắn, lớp được phân công, số thiếu nhi, cảnh báo, nút điểm danh hôm nay. Thẻ buổi học có thể thu gọn nếu người dùng chỉ có một lớp.
2. Điểm danh: lớp/ngày, tiến độ gọn, Quét QR, Danh sách/Sơ đồ, tìm tên, các em và trạng thái. Hành động Tất cả có mặt đưa vào menu buổi với xác nhận rõ phạm vi. Nút tích trong hình chỉ là minh họa; triển khai phải có nhãn dễ hiểu và tên truy cập, cùng lựa chọn vắng có phép, không phép, đi trễ và xóa trạng thái.
3. Quét QR: giáo lý viên quét thẻ của từng em, xác nhận tên/lớp và phản hồi lưu, sau đó quét tiếp. Đây là giả định thiết kế cho nhu cầu QR từ phiên trước, cần chốt cơ chế trước khi triển khai.

## Trạng thái phải thiết kế khi triển khai

- Đang lưu / đã lưu / lỗi lưu và thử lại; không hiển thị đã lưu trước khi máy chủ xác nhận.
- QR trùng: thông báo đã điểm danh, không tạo ghi nhận mới. Sai lớp/mã không hợp lệ: không cập nhật.
- Camera chưa được cấp quyền/không khả dụng: hướng dẫn ngắn và nút tìm tên.
- Mã QR chỉ mang định danh opaque; kiểm tra quyền giáo lý viên, lớp và buổi trên máy chủ.
- Buổi nghỉ lễ và lớp chỉ đọc: không cho ghi nhận bằng QR hay thao tác tay.
- Không có lớp, lớp trống, tên dài/trùng tên, không có sơ đồ, thiếu nhi chưa xếp chỗ.
- Trên điện thoại, tiến độ và điều khiển ngắn gọn; tránh nhiều lớp thanh cố định che danh sách.

## Luồng chính

Đăng nhập → Chọn lớp → Điểm danh hôm nay → Quét QR hoặc chọn thủ công → Kiểm tra các em chưa điểm danh → Xem tổng kết.

Không thêm nút Lưu cuối buổi vì ứng dụng hiện lưu từng thao tác. Hoàn thành nếu bổ sung chỉ dẫn đến tổng kết, không ngầm đổi trạng thái các em chưa được ghi nhận.
