# Phân tích UI/UX và định hướng xây lại — v2

Ngày: 12/10/2026. Phạm vi người dùng đã xác nhận: làm đồng bộ giáo lý viên và quản trị; vai trò quản trị hiện có trong sản phẩm là **trưởng khối**.

Trạng thái: bản phân tích và định hướng, chưa triển khai giao diện.

## 1. Kết luận

Nên xây lại cách tổ chức công việc, điều hướng và bố cục theo thiết bị. Vấn đề lớn nhất không nằm ở bảng màu: nhiều tác vụ được trình bày ngang hàng, vùng làm việc điểm danh bị đẩy xuống dưới, quản lý khối là một trang dài chứa cả số liệu lẫn biểu mẫu, còn máy tính sử dụng cùng khung hẹp và thanh dưới của điện thoại.

Một sản phẩm thống nhất cần hai bố cục phù hợp: giáo lý viên làm việc nhanh trên điện thoại; trưởng khối tra cứu, so sánh và quản lý trên vùng làm việc rộng. Hai bố cục dùng chung tên chức năng, ngôn ngữ trạng thái, màu sắc và thành phần.

## 2. Cơ sở và giới hạn

- Đã đọc mã hiện tại của trang chủ, khung ứng dụng, điều hướng lớp, bảng điểm danh, danh sách thiếu nhi, thống kê, quản lý khối, năm học, thành phần giao diện và tài liệu trước đó. Có hai lượt đánh giá độc lập về luồng sử dụng và hệ thống thị giác.
- `http://localhost:3200/login` trả HTTP 200 tại thời điểm kiểm tra. Điều này xác nhận đường đăng nhập hoạt động, không xác nhận các trang cần đăng nhập hoặc toàn bộ nghiệp vụ.
- Chưa quan sát được giao diện chạy thật: Playwright không khởi động được do sandbox Chromium; công cụ trình duyệt của ứng dụng không có trình duyệt khả dụng. Một số thao tác đọc/mở trình duyệt cũng gặp lỗi 429 ở hệ thống xét duyệt tự động.
- Các tác động UX dưới đây là suy luận từ thứ tự bố cục và điều khiển trong mã. Chưa đo chiều cao màn hình, thời gian điểm danh, mức độ nhầm lẫn hoặc tốc độ trên điện thoại thật; không chấm điểm UX giả định.
- Các tài liệu `proposal.md` và `docs/ui-draft/` là tài liệu lịch sử cần đối chiếu với mã, không phải mô tả đầy đủ phiên bản hiện tại.

## 3. Vấn đề cần giải quyết

| Ưu tiên | Hiện trạng đã xác nhận | Tác động dự kiến | Hướng sửa |
|---|---|---|---|
| P1 | Khung chung `max-w-3xl`, thanh điều hướng dưới luôn hiện: `src/app/(app)/layout.tsx:7`, `src/components/nav/BottomNav.tsx:22` | Máy tính có ít không gian cho bảng, báo cáo và quản trị | Sidebar trên màn lớn; nội dung rộng theo tác vụ; thanh dưới ở màn nhỏ |
| P1 | Header lớp cố định và 5 tab, trong khi thanh dưới vẫn hiện: `src/app/(app)/lop/[classId]/layout.tsx:18`, `src/components/nav/ClassTabs.tsx:6` | Hai tầng điều hướng cạnh tranh với vùng làm việc | Ba mục lớp chính; công cụ phụ đặt theo ngữ cảnh; màn thao tác buổi có khung gọn riêng |
| P1 | Tiến độ, QR, tất cả có mặt, đánh vắng và nghỉ lễ nằm trước danh sách: `AttendanceBoard.tsx:92`; khối đi lễ ở `:149`, chọn sơ đồ/danh sách ở `:154`, danh sách ở `:193` | Phải đi qua nhiều điều khiển trước khi thấy học sinh; thao tác hiếm chiếm vị trí quan trọng | Đầu màn chỉ giữ lớp/ngày, tiến độ lưu, tìm kiếm và lọc; chuyển hành động hàng loạt vào công cụ buổi |
| P1 | Trang Khối gồm tổng quan, lớp, đường năm học/báo cáo, rồi biểu mẫu tạo lớp, tạo GLV, gán/gỡ GLV, ngưỡng và đặt lại mật khẩu: `src/app/(app)/khoi/page.tsx:38` | Tìm việc cần làm bằng cách cuộn; chỉnh đối tượng bằng các form rời nhau | Dashboard dành cho theo dõi; trang danh sách riêng; tạo/sửa mở từ đối tượng đang chọn |
| P2 | Bảng điểm danh và danh sách thiếu nhi hiển thị toàn bộ danh sách, chưa có tìm tên/lọc tại các màn này: `AttendanceBoard.tsx:194`, `thieu-nhi/page.tsx:38` | Khó tìm em cụ thể, em chưa điểm danh và em đã ẩn | Tìm tên; bộ lọc trạng thái; số kết quả; nút xóa bộ lọc |
| P2 | Danh sách có **Có / Vắng / Khác**: `AttendanceBoard.tsx:216`; sơ đồ được chọn mặc định khi có: `:44` | Nhãn “Khác” chưa nói rõ các lựa chọn; chế độ mặc định chưa phản ánh sở thích | Nhãn đầy đủ, bộ chọn trạng thái rõ; nhớ lựa chọn Danh sách/Sơ đồ |
| P2 | Hàng thiếu nhi chứa tên, tên thánh, ngày sinh, số điện thoại, sửa và ẩn/hiện: `thieu-nhi/StudentRow.tsx:40` | Nhiều thông tin cạnh tranh với việc nhận diện tên trên màn nhỏ | Danh sách ưu tiên tên/trạng thái; liên hệ và chỉnh sửa ở chi tiết hoặc menu; desktop hiện thêm cột |
| P2 | `src/components/ui/Sheet.tsx:9` tập trung focus vào container và xử lý Escape, nhưng shared component chưa có giữ/khôi phục focus, vô hiệu nền, khóa cuộn và nút đóng chung | Tác vụ bàn phím và hội thoại dài có thể khó kiểm soát | Một thành phần hội thoại có đầy đủ focus, đóng, cuộn; bottom sheet mobile và dialog/drawer desktop |

Đường dẫn ngắn trong bảng được tính từ `src/app/(app)/lop/[classId]/`; riêng `AttendanceBoard.tsx` thuộc `diem-danh/[date]/`.

## 4. Điều cần sửa trong đề xuất cũ

1. **Trang chủ đã có hành động nhanh.** `src/app/(app)/page.tsx:60` hiện nút điểm danh và QR. Không còn đúng khi nói người dùng bắt buộc qua hai bước. Cần cải thiện nội dung thẻ lớp để thấy tình trạng buổi, thay vì thêm nút trùng chức năng.
2. **Đi muộn/có phép không chỉ dùng nhấn giữ.** Danh sách có nút “Khác” nhìn thấy được. Vấn đề là độ rõ của nhãn và số bước, không phải hoàn toàn thiếu đường thao tác.
3. **Không đặt tên và bốn nút lớn trong hàng 56px trên điện thoại.** 375px trừ hai lề 16px còn 343px. Bốn nút 48px và ba khoảng 8px chiếm 216px, chỉ còn 127px cho tên, chưa tính khoảng cách giữa tên và nhóm nút. Dùng hàng hai tầng hoặc bộ chọn mở rộng; desktop có thể hiện đủ lựa chọn.
4. **Không kết luận mọi ô ghế quá nhỏ.** `StudentButton.tsx:30` có ô 64×88px và dải tùy chọn cao 44px. Cần kiểm tra phần tử bấm, khoảng cách, tên dài và mật độ sơ đồ trên thiết bị thật.
5. **Bóng đổ không tự nó là lỗi UX.** Quyết định độ phẳng phải nhất quán và phục vụ phân lớp thông tin. Ưu tiên cải thiện phân cấp, không chỉ xóa hiệu ứng.
6. Không coi trưởng khối là quản trị toàn hệ thống; không tự mở rộng quyền trong thiết kế mới.

## 5. Kiến trúc thông tin mới

### Giáo lý viên

- **Hôm nay:** lớp được phân công, ngày và tình trạng buổi, việc cần tiếp tục.
- **Lớp:** danh sách lớp và khu vực làm việc lớp.
- **Cần chú ý:** thiếu nhi cần theo dõi theo quy tắc cảnh báo hiện có, liên kết đến hồ sơ.
- Tài khoản ở menu cá nhân.

Trong lớp: **Điểm danh · Thiếu nhi · Thống kê**. Sơ đồ, thẻ QR và nhật ký nằm trong công cụ của lớp hoặc màn tương ứng. Khi vào thao tác một buổi, dùng header gọn với tên lớp, ngày và đường trở về lớp; tránh giữ thêm toàn bộ tab lớp và thanh dưới cùng lúc.

### Trưởng khối

Sidebar trên máy tính:

- **Tổng quan:** số liệu học kỳ, lớp cần xử lý; bấm lớp để đi tiếp.
- **Lớp:** danh sách, giáo lý viên phụ trách và hành động tạo/chỉnh theo quyền.
- **Giáo lý viên:** tài khoản, phân công, thao tác đặt lại mật khẩu từ đúng người đang chọn.
- **Cần chú ý:** tình trạng cần theo dõi trong phạm vi khối.
- **Báo cáo:** chọn học kỳ và lớp, xem kết quả rồi in/xuất.
- **Năm học:** năm/học kỳ, lên lớp và lịch sử.
- **Cài đặt khối:** ngưỡng cảnh báo và cấu hình khối kế tiếp.

Trên điện thoại, rút gọn thành **Tổng quan · Lớp · Cần chú ý · Quản lý**; mục Quản lý mở các chức năng còn lại. Trưởng khối được phân công ghi lớp vẫn vào được màn điểm danh chung. Các trang mới là cách tổ chức lại chức năng hiện có; quyền đọc/ghi tiếp tục theo kiểm tra hiện tại.

## 6. Luồng và màn hình trọng tâm

### 6.1 Hôm nay

Mỗi lớp hiển thị tên, sĩ số, ngày, số em đã được ghi nhận và tình trạng lưu. Nút chính theo ngữ cảnh: **Điểm danh hôm nay**, **Tiếp tục**, hoặc **Xem buổi** khi chỉ đọc; QR là đường vào nhanh cho người có quyền.

Phân biệt chưa có buổi, còn thiếu ghi nhận, đủ ghi nhận đã lưu, nghỉ lễ và chỉ xem. Không tự đặt trạng thái “buổi đã đóng” vì hiện chưa xác nhận có nghiệp vụ đóng buổi. Không thêm lịch dạy, giờ học hoặc trạng thái làm xong từ suy đoán; các dữ liệu mới cần được thiết kế và cung cấp trước khi đưa lên màn hình.

### 6.2 Điểm danh

Thứ tự: **lớp + ngày → tiến độ/lưu → tìm tên và lọc → danh sách**.

- Bộ lọc: Tất cả, Chưa điểm danh, Có mặt, Đi muộn, Vắng có phép, Vắng không phép.
- Điện thoại: tên có đủ chỗ xuống dòng; trạng thái có chữ; hàng hai tầng với hành động Có mặt/Vắng và nút **Đổi trạng thái** mở đủ lựa chọn, gồm xóa ghi nhận. Prototype cần so sánh với hàng mở rộng bốn lựa chọn trước khi chốt.
- Máy tính: tên, thông tin nhận diện phụ và trạng thái theo cột; có thể hiện đủ lựa chọn trên hàng nếu đủ chiều rộng.
- Danh sách là điểm bắt đầu đề xuất cho người mới, có thể chọn Sơ đồ và nhớ lựa chọn. Đây là thay đổi UX cần thử với giáo lý viên đang quen sơ đồ.
- Quét QR là hành động chính dễ tới bằng ngón cái; thao tác Tất cả có mặt, nghỉ lễ và đánh vắng hàng loạt vào công cụ buổi hoặc bước rà soát. Xác nhận phải nêu số em và phạm vi thực sự bị thay đổi; không tự sửa phạm vi nghiệp vụ của API.
- Giáo lý và đi lễ thành hai chế độ công việc rõ tên, rõ ngày. Không trộn số đếm, không lấy ngày buổi giáo lý làm ngày đi lễ một cách ngầm định.
- **Rà soát buổi** cho thấy em chưa điểm danh và lỗi/chờ lưu. Mở rà soát không ghi dữ liệu; không thêm nút Lưu cuối buổi hoặc tự đánh vắng.

### 6.3 Quét QR

Giữ camera hoạt động liên tục và màn riêng. Ưu tiên tên em vừa đọc, loại ghi nhận và tình trạng **Đã đọc → Đang gửi → Đã lưu / Chưa gửi được**. Không coi tiếng bíp hoặc bộ đếm cục bộ là xác nhận máy chủ.

Tìm tên là phương án rõ ràng khi quên thẻ hoặc camera lỗi. Chế độ Có mặt/Đi muộn luôn có nhãn. Các lượt cần xử lý, gửi lại và hoàn tác nằm gần kết quả. Đường **Về bảng điểm danh** giữ cảnh báo khi còn lượt chưa gửi; không thêm bước hỏi khi không có dữ liệu cần bảo vệ.

### 6.4 Thiếu nhi và hồ sơ

Danh sách có tìm kiếm, Đang học/Đã ẩn, số kết quả và hành động thêm/nhập/in thẻ gọn. Chạm tên mở hồ sơ; hành động sửa/ẩn không chen vào vùng bấm tên. Hồ sơ gom thông tin, liên hệ phụ huynh, chuyên cần và đi lễ theo nhóm. QR và cấp lại mã thuộc công cụ thẻ, giữ quyền và cảnh báo hiện tại.

### 6.5 Quản lý khối

Dashboard trả lời “lớp nào cần xem, còn việc gì cần xử lý”. Không đặt form tạo tài khoản hoặc đặt lại mật khẩu thường trực dưới số liệu. Từ danh sách lớp chọn lớp để phân công; từ danh sách GLV chọn người để sửa phân công hoặc đặt lại mật khẩu. Biểu mẫu mở theo yêu cầu, lỗi gắn với trường, kết quả thành công hiển thị tại đối tượng.

Theo dõi buổi hôm nay ở cấp khối là dữ liệu bổ sung cần truy vấn và kiểm chứng, không phải chỉ đổi cách trình bày số liệu học kỳ đang có.

### 6.6 Báo cáo và năm học

Báo cáo có vùng chọn năm/học kỳ/lớp trong phạm vi quyền; hiện bộ lọc đang áp dụng, ngữ cảnh lịch sử và nhãn thiếu nhi đã chuyển lớp. Máy tính ưu tiên bảng; điện thoại tóm tắt và danh sách để đọc, giữ bản in riêng.

Trang năm học phân rõ danh sách năm, tạo năm mới, cấu hình khối tiếp và thao tác lên lớp. Giữ wizard xem trước và xác nhận hiện có, phạm vi chuyển, lịch sử, thời hạn hoàn tác và giới hạn không khôi phục chỗ ngồi. Không thay đổi chính sách chuyển lớp hoặc quyền xem dữ liệu khối khác trong đợt UI.

## 7. Hướng thị giác và thành phần

Hướng đề xuất: **Sổ lớp hiện đại** — nền sáng, chữ rõ, đường phân cách nhẹ, thông tin lớp/ngày/học kỳ luôn ở một vị trí ổn định. Điểm nhận diện là dải ngữ cảnh lớp và ngày gọn ở đầu vùng làm việc, dùng cùng nhịp trên điện thoại và desktop.

Giữ Be Vietnam Pro và Lexend đang có, cùng nền trung tính và xanh hành động. Điều chỉnh tỷ lệ chữ, khoảng cách và mức độ nhấn thay vì thay toàn bộ font/màu. Màu trạng thái luôn kèm chữ hoặc biểu tượng, không dùng màu đơn độc để phân biệt ý nghĩa. Nền trắng dành cho vùng làm việc, viền để nhóm; bóng nhẹ dành cho lớp nổi nếu cần, tránh lặp bóng trên mọi thẻ.

Đánh giá định hướng trước triển khai: tác động thị giác 4/5, phù hợp 5/5, khả thi 4/5, an toàn hiệu năng 5/5, rủi ro nhất quán 3/5; DFII = 15. Đây là đánh giá thiết kế, không phải số đo người dùng.

Nhịp đề xuất 4/8px; lề mobile 16px; điều khiển tác vụ chính hướng tới 44–48px; tên đầy đủ và trạng thái dễ đọc quan trọng hơn cố giữ hàng thấp. WCAG 2.2 AA có tiêu chí tối thiểu 24×24 CSS px với ngoại lệ khoảng cách; 44–48px ở đây là mục tiêu thao tác của sản phẩm, không gọi là chuẩn AA bắt buộc.

Chuẩn hóa: khung ứng dụng, header/ngữ cảnh, bảng/danh sách, tìm kiếm/lọc, bộ chọn trạng thái, tình trạng lưu, menu hành động, hội thoại theo thiết bị, biểu mẫu và trạng thái trống/lỗi. Tổ chức theo trách nhiệm trong cấu trúc hiện tại, không buộc chuyển mọi component vào một thư mục mới.

Nguồn trợ năng: [W3C — Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [W3C — Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

## 8. Hành vi cần bảo toàn

- Lưu từng thao tác; UI cập nhật nhanh nhưng “Đã lưu” phải dựa vào xác nhận máy chủ.
- Hoàn tác, xử lý lỗi/thử lại và cảnh báo rời trang khi dữ liệu chưa lưu.
- Hàng chờ QR theo thiết bị; điểm danh thủ công không được quảng bá như có cùng khả năng chịu mất mạng. README mô tả hai cơ chế khác nhau, cần kiểm lại bằng kiểm thử khi triển khai.
- Nghỉ lễ, chỉ xem, dữ liệu cũ và hàng chờ chưa gửi có giải thích rõ; không chỉ làm mờ nút.
- Bảo toàn phân quyền, ngày/học kỳ, số liệu lịch sử, QR và chính sách lên lớp.
- Không thay đổi backend hoặc database chỉ vì thay khung giao diện; bổ sung truy vấn khi màn mới thực sự cần dữ liệu mới.

## 9. Lộ trình đề xuất

1. **Xác nhận hiện trạng trên trình duyệt:** chụp màn 375/390px, 768px, 1440px; đi qua cả hai vai trò với dữ liệu thử. Đo số bước, khả năng đọc tên, thời gian tìm em và các tình trạng lưu.
2. **Prototype bốn màn nền:** Hôm nay, Điểm danh, Tổng quan khối, Quản lý lớp/GLV. Thử tên Việt dài/trùng tên, lớp trống/lớp đông và các tình trạng lỗi ngay trong prototype.
3. **Làm hệ thống chung:** khung responsive, điều hướng, header, biểu mẫu, hội thoại và trạng thái lưu.
4. **Thay luồng hoàn chỉnh:** Hôm nay → bảng → QR → rà soát; song song Tổng quan → lớp/GLV → chỉnh sửa. Tiếp theo hồ sơ, báo cáo, năm học và nhật ký.
5. **Kiểm chứng rồi thay giao diện cũ:** test hành vi hiện có, tương tác bàn phím, ảnh đối chiếu và thao tác thực tế trên điện thoại. Triển khai theo luồng để luôn còn phiên bản sử dụng được.

Không bắt đầu bằng việc đổi màu toàn ứng dụng rồi xử lý cấu trúc sau. Các màn nền cần thể hiện được hướng chung trước khi sửa hàng loạt.

## 10. Tiêu chí nghiệm thu đề xuất

Đây là mục tiêu cần thử, chưa phải kết quả đạt được:

- Từ Hôm nay vào điểm danh buổi của lớp bằng một hành động chính; thẻ lớp hiển thị đúng tình trạng buổi.
- Tìm và chọn một thiếu nhi không cần cuộn dò cả danh sách; bộ lọc Chưa điểm danh luôn phản ánh dữ liệu hiện tại.
- Một màn thao tác buổi chỉ có một lớp điều hướng cố định cần thiết; danh sách không bị thanh hành động/keyboard che.
- Tên Việt dài, trùng tên và phóng chữ vẫn phân biệt được đối tượng; trạng thái không phụ thuộc màu.
- Quản trị chọn đối tượng trước khi sửa; không phải cuộn qua các form không liên quan để phân công GLV.
- Hội thoại dùng được bằng bàn phím, giữ focus bên trong và trả focus về đúng nơi mở.
- Không hiển thị hoàn tất khi còn lượt lỗi/chờ; thao tác hàng loạt nêu rõ phạm vi và bảo toàn hoàn tác hiện có.
- Không hồi quy các luồng lớp chỉ xem, nghỉ lễ, quét trùng, lỗi mạng, quay lại, đi lễ khác ngày, học kỳ cũ và lên lớp.

## 11. Bước tiếp theo

Hướng nền đã đủ để bắt đầu prototype cả hai vai trò. Cần quan sát và đo trên web thật trước khi chốt mật độ hàng điểm danh, cách chuyển Danh sách/Sơ đồ và phân chia thanh điều hướng. Chưa có cơ sở để cam kết mức giảm thời gian, số chạm trung bình hoặc tỷ lệ lỗi.
