# Admin toàn hệ thống và lớp theo năm học

## Phạm vi

Admin quản lý mọi tài khoản giáo lý viên/khối trưởng, danh mục khối và lớp theo năm. Khối trưởng và giáo lý viên giữ giới hạn hiện có. Trang quản trị có bộ lọc năm/khối, tài khoản có thể khóa/mở lại, đổi vai trò và đặt lại mật khẩu. Lớp cùng tên ở hai năm có ID khác nhau.

## Quyết định

Giữ khối và tài khoản xuyên năm. Bổ sung quyền admin, trạng thái hoạt động và `sessionVersion` trên tài khoản, đọc lại từ database mỗi request. Lớp có năm học bắt buộc và tên duy nhất trong một khối/năm; không chuyển năm của lớp bằng thao tác sửa thông tin. Khi chuyển thiếu nhi, giữ hồ sơ và mã QR; bảng `class_memberships` lưu cả lớp nguồn/lớp đích để trẻ chưa từng điểm danh cũng còn trong danh sách cũ. Hồ sơ em đã chuyển khỏi lớp cũ chỉ đọc tại lớp cũ.

Phương án liên kết một lớp dùng chung cho nhiều năm ít thay đổi hơn nhưng vẫn trộn roster, sơ đồ và phân công. Phương án lớp riêng từng năm cần bổ sung phạm vi năm vào điểm danh, thống kê, lên lớp và giao diện, phù hợp yêu cầu tách các năm.

Trang chủ, danh sách lớp, trang Khối và báo cáo chọn năm học rõ ràng. Năm mặc định là năm hiện tại; trong kỳ nghỉ dùng năm gần nhất đã bắt đầu thay vì tự nhảy sang năm được tạo sẵn. Tạo năm không tự sao chép lớp/phân công. Lượt lên lớp chọn lớp đích cùng năm hoặc năm bắt đầu sau năm nguồn; admin có thể chọn mọi khối, trưởng khối chỉ chọn cùng khối hoặc khối kế tiếp.

## Chuyển đổi dữ liệu

Lớp cũ đã ghi trong một năm được gắn đúng năm đó. Lớp chưa có buổi dùng năm hiện tại/năm gần nhất; chỉ tạo nhãn “Dữ liệu cũ” nếu có lớp nhưng chưa có năm nào. Nếu một lớp cũ đã dùng qua nhiều năm, migration dừng với thông báo rõ thay vì âm thầm gán toàn bộ lịch sử vào một năm. Việc chia trường hợp này cần một migration ánh xạ riêng để giữ đúng lịch sử và liên kết cũ.

Database có giá trị năm mặc định cho các công cụ nhập cũ; giao diện và dịch vụ tạo lớp luôn chọn và kiểm tra năm rõ ràng. Buổi học/đi lễ và báo cáo phải thuộc cùng năm với lớp. Xóa năm/khối/lớp bị từ chối nếu còn dữ liệu liên quan; không xóa dây chuyền lịch sử.

## Phân quyền và nhật ký

Chỉ admin được quản lý tài khoản admin và khối trưởng ở toàn hệ thống. Không cho tự khóa/hạ quyền, kiểm tra admin hoạt động cuối cùng trong transaction có khóa. Các thay đổi quyền/trạng thái và thao tác quản trị dùng chung khóa, đọc lại trạng thái và phiên bản của người thực hiện sau khi lấy khóa; yêu cầu đang chờ không được dùng quyền đã bị thu hồi.

Đổi vai trò/khối, khóa/mở lại, đặt lại mật khẩu hoặc tự đổi mật khẩu tăng `sessionVersion`. Phiên chỉ được chấp nhận khi phiên bản trong cookie trùng database, nên khóa rồi mở lại hoặc đổi nhiều lần trong cùng một giây không làm cookie cũ có hiệu lực trở lại. Tự đổi mật khẩu cấp phiên mới cho chính thiết bị đang đổi, các phiên khác hết hiệu lực. Phiên được làm mới giữ nguyên phiên bản và giới hạn tuyệt đối tính từ lần đăng nhập gốc.

Không trả hash hoặc ghi mật khẩu/token vào nhật ký. Các thao tác tài khoản/khối/năm được ghi nhật ký toàn hệ thống; nhật ký lớp giữ phạm vi lớp/khối cũ. Giao diện chưa có trang xem nhật ký toàn hệ thống riêng.

Admin đầu tiên được tạo bằng công cụ cục bộ với thông tin do người vận hành cung cấp; bản thử dùng dữ liệu mẫu riêng. Không có tài khoản admin mặc định hoặc mật khẩu sản xuất trong mã/tài liệu.

`pnpm admin:create` chạy `scripts/create-admin.ts`, đọc `ADMIN_EMAIL` và `ADMIN_NAME`. Tài khoản mới nhập mật khẩu ẩn hai lần trên terminal; môi trường không tương tác cần cấp `ADMIN_PASSWORD` qua kênh bảo mật. Với tài khoản đã tồn tại, bỏ qua `ADMIN_PASSWORD` giữ hash hiện tại; nâng quyền/kích hoạt lại vẫn thu hồi phiên cũ. Công cụ gọi dịch vụ bootstrap riêng, không được đưa ra một route công khai.

## Kiểm chứng

Kết quả kiểm tra hiện tại ngày 13/10/2026:

- 215 kiểm thử dịch vụ/tích hợp qua 12 bộ kiểm thử đạt; 95 kiểm thử xác thực qua 6 bộ đạt.
- Kiểm tra TypeScript, lint và bản build production đạt.
- 50 hành trình Playwright về admin, năm học, lên lớp và trang chủ đã đạt qua lượt chính và lượt xác nhận lại: 47 đạt ở lượt chính; ba luồng điện thoại được tăng thời gian chờ biên dịch lần đầu rồi chạy lại đạt. Điện thoại 375px, tablet 768px, laptop 1280px và PC 1440px; desktop chạy các hành trình trang chủ và quản trị.
- Ba kiểm thử nhiều kết nối PostgreSQL thật đạt: hai admin khóa/hạ quyền nhau chỉ một thao tác được phép và còn một admin hoạt động; yêu cầu chờ của admin bị đặt lại mật khẩu bị từ chối sau khi lấy khóa.
- 39 kiểm thử cuối về lớp theo năm, quyền khối trưởng, thu hồi phiên và cấu trúc xác thực đạt, gồm năm học sai định dạng trả về kết quả rỗng/404.
- Bản build đang chạy với database mẫu riêng đã đăng nhập admin, lọc lớp theo năm và kiểm tra không tràn màn hình ở 375, 768, 1024, 1280, 1440 và 1920px. Trang năm học 375px cũng không tràn sau khi xếp các ô ngày theo chiều dọc.

Các con số trên là các nhóm kiểm thử đã chạy, có thể chồng lặp; không phải tổng số kiểm thử của toàn dự án. Lượt mở rộng toàn bộ unit đã dừng khi máy quá tải gây timeout; không dùng lượt đó làm bằng chứng đạt toàn suite.

Các kiểm thử xác thực gồm thu hồi phiên qua thay đổi quyền, khóa/mở lại trong cùng một giây, đặt lại mật khẩu, tự đổi mật khẩu và yêu cầu quản trị bị chờ sau khi phiên bị thu hồi. Các kiểm thử dữ liệu gồm lớp cùng tên ở hai năm khác nhau, phạm vi năm của buổi/báo cáo, danh sách lớp cũ sau lên lớp và migration dừng khi dữ liệu lớp cũ trộn nhiều năm.
