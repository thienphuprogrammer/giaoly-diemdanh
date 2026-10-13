# UX brainstorm — Điểm danh QR liên tục

Ngày: 11/10/2026. Trạng thái: đang thảo luận, chưa chốt thiết kế hoặc triển khai.

## Nhu cầu đã xác nhận

Giáo lý viên quét thẻ của từng em. Ưu tiên điện thoại, ít ghi nhầm, phản hồi lưu rõ ràng. Người dùng nêu thời gian chờ tải sau mỗi lượt quét là vấn đề cần giải quyết.

## Bằng chứng và giới hạn

Tìm kiếm mã nguồn hiện tại chưa thấy bộ quét QR trong src hoặc dependency QR trong package.json. Chưa xác định màn hình/phiên bản mà người dùng đang trải nghiệm và chưa đo độ trễ. Không quy kết nguyên nhân cho camera, mạng hoặc database.

## Phương án đang xem xét

1. Khuyến nghị: camera mở xuyên suốt, nạp danh sách lớp và ánh xạ mã được phép trước khi quét, phản hồi đọc mã ngay, hàng đợi gửi nền có giới hạn và trạng thái theo từng lượt. Máy chủ vẫn kiểm tra quyền, lớp, buổi và mã. Không tải lại trang hoặc toàn bộ danh sách sau mỗi mã.
2. Ghi máy chủ từng lượt rồi cho quét tiếp: ít phức tạp hơn nhưng tốc độ nối tiếp vẫn phụ thuộc mạng.
3. Lưu bền trên thiết bị và đồng bộ sau: hỗ trợ mất mạng nhưng mở rộng phạm vi offline, tăng trách nhiệm giữ dữ liệu, bảo vệ thông tin và giải quyết xung đột.

## Hành vi đề xuất, chưa duyệt

- Trạng thái riêng: Đã đọc thẻ / Đang lưu / Đã lưu / Chưa lưu được. Chỉ trạng thái đã lưu được tính vào số máy chủ xác nhận.
- Duy trì camera, không phủ modal sau mỗi lượt. Hiện tên nổi bật và vài lượt gần nhất.
- Chặn phát hiện lặp của cùng mã còn nằm trong khung; cho phép mã mới ngay. Không dùng thời gian khóa chung quá dài.
- Hàng đợi gửi nền có giới hạn, thứ tự theo từng em và chống ghi trùng trên máy chủ. Gửi lại khi timeout không tạo bản ghi trùng.
- Nếu hàng đợi tăng hoặc lỗi kéo dài: thông báo rõ, ngừng nhận thêm khi vượt giới hạn; không hứa tự lưu offline ở phiên bản này.
- Quét lại em đã có mặt: thông báo đã ghi nhận. Em đang có trạng thái vắng/đi trễ: không âm thầm ghi đè; dùng quy tắc rõ ràng hoặc yêu cầu chọn sửa.
- Lớp sai, mã không hợp lệ, buổi nghỉ lễ hoặc quyền chỉ đọc: không ghi; phản hồi dễ phân biệt với lượt thành công.
- Khi đóng scanner hoặc rời trang còn lượt chưa lưu: hiển thị số lượt đang chờ và lựa chọn ở lại; hàng đợi trong bộ nhớ không đảm bảo sống qua đóng tab hoặc hệ điều hành dừng ứng dụng.
- Tách âm/rung đọc được mã khỏi phản hồi lưu; người dùng có thể tắt âm. Không chỉ dùng màu.

## Mục tiêu kiểm chứng

Phản hồi đọc mã dưới 300ms trong điều kiện kiểm thử xác định, sau khi camera sẵn sàng; không coi đây là cam kết mọi thiết bị. Camera không khởi động lại giữa các lượt. Quét 30 thẻ liên tục, mã lặp, phản hồi server chậm/lỗi, mất mạng, rời trang, đổi quyền và sửa cùng em từ hai thiết bị. Đo riêng khởi động camera, giải mã, gửi yêu cầu và xác nhận lưu; dùng median/p95 và thử trên điện thoại phổ thông.

## Quyết định

- Đã chốt với người dùng: giáo lý viên quét thẻ từng em, không phải thiếu nhi tự quét mã buổi học.
- Đã chốt với người dùng: tốc độ và thời gian chờ là trọng tâm brainstorm tiếp theo.
- Chưa chốt: hàng đợi nền thay vì chờ từng lượt; offline bền; quy tắc đi trễ; loại thiết bị và chất lượng mạng; thẻ in và cấp lại; quy mô đồng thời.

## Bổ sung ngày 12/10/2026 — Queue + Redis

Người dùng đề xuất tận dụng queue và Redis để tối ưu quét liên tục. Đây là hướng đang phân tích; chưa chọn thư viện, hạ tầng hoặc triển khai.

Luồng đề xuất: camera đọc mã tại thiết bị → hàng chờ gửi trên thiết bị → API xác thực và kiểm tra quyền/lớp/buổi → thêm sự kiện vào queue Redis → worker ghi Postgres → cập nhật kết quả từng sự kiện cho UI. Camera không chờ worker hoàn thành để đọc mã tiếp theo. Queue Redis giúp tách thời gian nhận yêu cầu khỏi xử lý và hấp thụ lượt quét dồn; không cải thiện trực tiếp lấy nét, giải mã hoặc kết nối từ điện thoại tới API.

Kiểm tra mã hiện tại: đường ghi điểm danh thành công có nhiều truy vấn nối tiếp để đọc user, buổi, lớp, phân công, thiếu nhi, upsert điểm danh và đếm vắng. Bản thân upsert nhỏ; client đã cập nhật UI trước khi chờ server và action không revalidate toàn trang sau mỗi lượt. Cần tối ưu số vòng truy vấn trong đường nhận sự kiện và đo độ trễ thực tế; chưa có bằng chứng database write là nút thắt chính. File tham chiếu: src/server/services/attendance.ts, src/db/queries/access.ts, src/lib/auth/dal.ts, src/app/(app)/lop/[classId]/diem-danh/[date]/actions.ts và AttendanceBoard.tsx.

UI chính chỉ cần hiển thị Đang gửi / Đã nhận, đang lưu / Đã lưu / Cần xử lý. Đã nhận trong queue không đồng nghĩa đã commit điểm danh. Sau khi server nhận, việc xử lý có thể tiếp tục dù đóng scanner, với điều kiện queue và worker được cấu hình đúng; những lượt chưa tới server vẫn cần được giữ và gửi lại trên thiết bị nếu muốn hỗ trợ đóng tab/offline.

Ràng buộc đề xuất:

- Mỗi sự kiện có eventId ổn định qua các lần gửi lại; DB ghi nhận eventId cùng cập nhật điểm danh trong một transaction. Ràng buộc một bản ghi/em/buổi vẫn cần giữ.
- Không dùng riêng khóa em-buổi để loại mọi sự kiện: thao tác sửa hợp lệ cũng cần được tiếp nhận. Quét trùng không được ghi đè thao tác sửa mới hơn.
- Lượt quét có capturedAt; worker không dùng thời điểm chạy job để suy ra giờ đến. Thời gian client cần kiểm tra, không tin tuyệt đối nếu dùng quyết định đi trễ.
- Retry có backoff cho lỗi tạm thời; lỗi mã, quyền, buổi nghỉ lễ là lỗi nghiệp vụ, không retry vô hạn. Worker kiểm tra lại điều kiện hiện tại khi ghi.
- Giới hạn concurrency và hàng chờ; theo dõi tuổi job cũ nhất và sự kiện lỗi cuối cùng. Khôi phục worker không được làm dữ liệu trùng hoặc đảo thao tác sửa.
- Redis queue cần persistence và chính sách không đẩy mất key; không coi Redis cache thông thường là nơi lưu bền tuyệt đối. Mức đảm bảo nhận sự kiện phải được chốt và kiểm thử khi Redis khởi động lại.
- Cần nơi chạy worker có vòng đời phù hợp. Không khởi tạo worker tạm trong từng request rồi trả response.
- So sánh đo thực tế với ghi Postgres trực tiếp trước khi khẳng định Redis làm nhanh hơn: chi phí mạng/validate vẫn còn, queue có thể tăng thời gian tới commit.

Tham khảo: https://docs.bullmq.io/guide/jobs/job-ids ; https://docs.bullmq.io/guide/retrying-failing-jobs ; https://docs.bullmq.io/guide/going-to-production ; https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/

## Bổ sung ngày 12/10/2026 — Lỗi QR và quét nhầm

Người dùng đồng ý tiếp tục hướng queue + Redis và yêu cầu làm rõ trường hợp QR lỗi hoặc quét sai. Các hành vi dưới đây là đề xuất UX, chưa triển khai.

### Nhóm tình huống

| Tình huống | Phản hồi và hành động đề xuất |
|---|---|
| Không đọc được, thẻ mờ/rách/chói | Chưa tạo lượt ghi nhận. Gợi ý chỉnh khoảng cách/ánh sáng, bật đèn nếu thiết bị hỗ trợ, hoặc Tìm tên. Camera giữ mở. |
| Mã không thuộc hệ thống, không còn hợp lệ | Không ghi nhận. Thông báo ngắn Mã không hợp lệ, dùng tìm tên; không tự mở URL có trong mã. Không retry lỗi nghiệp vụ. |
| Mã hợp lệ nhưng em không thuộc lớp/buổi được phép | Không ghi nhận, không tự chuyển lớp. Thông báo Thẻ không thuộc lớp đang điểm danh; không tiết lộ thông tin ngoài quyền đọc. |
| Quét lại thẻ của em đã có mặt | Thông báo Đã điểm danh. Không đổi trạng thái qua lại. Giữ nguyên đi trễ hoặc sửa thủ công mới hơn; xử lý trạng thái vắng theo quy tắc đã chốt sau. |
| Quét nhầm thẻ hợp lệ của em khác cùng lớp | Hệ thống không biết người đứng trước camera có phải chủ thẻ. Hiện họ tên rõ, có tên thánh khi cần phân biệt, và Hoàn tác/Chọn đúng em trên lượt cụ thể. Không coi QR là chứng minh danh tính. |
| Mạng/worker chậm hoặc phản hồi thất lạc | Hiển thị Đang gửi/Đã nhận, đang lưu/Đã lưu/Cần xử lý theo eventId. Kiểm tra kết quả rồi gửi lại cùng eventId khi phù hợp; không tạo lượt mới cho retry. |

### Sửa sai khi có queue

- Mỗi lượt gần đây có tên và trạng thái riêng. Nút Hoàn tác gắn vào lượt cụ thể, không mặc định thao tác cuối trên toàn lớp.
- Hoàn tác phải được server xác nhận. Nếu sự kiện chưa ghi, worker và thao tác hủy phải phối hợp bằng trạng thái/version được kiểm tra atomically; xóa job khỏi queue đơn thuần không ngăn job đang chạy ghi vào DB.
- Nếu lượt đã ghi, chỉ khôi phục trạng thái trước đó khi lượt đó vẫn là thay đổi hiện hành. Nếu có chỉnh sửa mới hơn, không đảo chỉnh sửa; thông báo Bản ghi đã thay đổi, mở để kiểm tra.
- Không biến thao tác Hoàn tác có mặt thành Vắng. Trước đó chưa điểm danh thì trả về chưa điểm danh; trước đó đi trễ/vắng thì khôi phục đúng trạng thái nếu vẫn đủ điều kiện.
- Cho quét/chọn đúng em tiếp theo sau khi yêu cầu sửa đã được ghi nhận rõ; theo dõi lỗi sửa riêng, không báo Hoàn tác xong trước xác nhận.
- Không mất tên lượt lỗi sau một toast ngắn; giữ danh sách Cần xử lý tới khi giải quyết. Nếu lượt không đọc được chưa xác định em, không đưa vào số em đã điểm danh.

### Nguyên tắc thao tác

Luồng bình thường không hỏi xác nhận mỗi thẻ. Hiện tên lớn để GLV đối chiếu; chỉ yêu cầu lựa chọn khi cần sửa trạng thái có sẵn hoặc giải quyết xung đột. Thêm nút Tìm tên và một lượt xác nhận đúng em trong luồng thủ công. Sửa nhầm là một hành động mới có lịch sử người sửa/thời điểm, không âm thầm xóa dấu vết quét.
