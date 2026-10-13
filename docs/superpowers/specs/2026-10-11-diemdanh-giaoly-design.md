# Web điểm danh lớp giáo lý — Thiết kế

Ngày: 2026-10-11 · Trạng thái: MVP nền đã duyệt và đã triển khai (2026-10-11); mốc QR đã duyệt thiết kế (2026-10-12), chưa triển khai; điều chỉnh khi lập kế hoạch: bỏ Auth.js, thêm `id` cho `gap`, trưởng khối xác định bằng `users.grade_id`

Cập nhật 2026-10-12 (bản này): mốc mở rộng QR được **đơn giản hóa** theo thảo luận —
ghi đồng bộ idempotent từ điện thoại (không Redis/queue/worker ở máy chủ), mã thẻ lưu
thẳng để in lại tự do, thêm công tắc quét "Có mặt / Đi muộn" (không tự suy ra đi muộn từ
giờ). Mục tiêu hàng đầu của mốc này là **độ trễ**. Phần QR là yêu cầu cho mốc mở rộng,
**chưa triển khai**; kế hoạch thực hiện là Mốc 7 (Task 15–21) của plan.

## 1. Mục tiêu

Giáo lý viên (GLV) điểm danh lớp giáo lý nhanh ngay tại lớp bằng điện thoại hoặc tablet,
và biết sớm em nào vắng không phép từ 2 buổi trở lên trong một học kỳ.

**Thành công khi:** điểm danh một lớp ~25 em trong vài chục giây, thấy cảnh báo ngay khi bấm,
trưởng khối nắm được tình hình cả khối.

### Phạm vi MVP
- Danh sách thiếu nhi của lớp, import CSV.
- Sơ đồ chỗ ngồi tùy chỉnh theo lớp (hàng → băng → ghế).
- Điểm danh theo buổi: chế độ sơ đồ và chế độ checklist.
- Đếm vắng, cảnh báo, thống kê, xuất Excel.
- Hai vai trò hiệu lực: GLV và trưởng khối.

### Mốc mở rộng QR
- Mỗi em một thẻ QR; GLV quét liên tục bằng camera điện thoại, ghi **Có mặt** hoặc
  **Đi muộn** (công tắc chế độ quét), tìm tên khi không quét được, hoàn tác lượt vừa quét.
- In thẻ cho cả lớp, in lại tự do, cấp lại mã khi mất thẻ.

### Ngoài phạm vi
Thông báo phụ huynh, chạy offline/đồng bộ lại bền, thiếu nhi/phụ huynh tự check-in,
nhận diện khuôn mặt, đơn xin nghỉ online, sơ đồ kéo-thả tự do, giao diện laptop riêng
(chỉ co giãn), Redis/queue/worker ở máy chủ (chỉ xét lại nếu số đo cho thấy cần, xem §7).

Hàng gửi nền trên điện thoại chỉ phục vụ phiên quét đang mở: không cam kết giữ lượt
chưa gửi khi đóng tab, tải lại hoặc hệ điều hành dừng ứng dụng.

## 2. Quy tắc nghiệp vụ

- Trạng thái điểm danh: `present`, `absent_excused`, `absent_unexcused`, `late`.
  Chưa điểm danh = không có bản ghi (không tính vào bất kỳ thống kê nào).
- Đếm theo **học kỳ**, riêng từng em. Chỉ `absent_unexcused` tính vào ngưỡng.
  `late` và `absent_excused` không tính.
- Cảnh báo: `none` (0 buổi) → `watch` (vàng, 1 buổi) → `warning` (đỏ, ≥ 2 buổi).
  Ngưỡng cấu hình được (mặc định 2). Đã hiện thực tại `src/lib/attendance/warning.ts`.
- Buổi nghỉ lễ (`cancelled`) không được tính vào thống kê.
- Mỗi lớp có tối đa 1 buổi/ngày.
- Trạng thái của một lượt quét trên giao diện tách khỏi 4 trạng thái điểm danh:
  `sending` (đang gửi), `saved` (máy chủ đã commit, gồm cả trường hợp không đổi gì),
  `needs_confirm` (cần GLV xác nhận), `rejected` (bị từ chối vì lỗi nghiệp vụ),
  `failed` (lỗi mạng/máy chủ, thử lại được), `undone` (đã hoàn tác).
  Chỉ `saved` được tính vào "đã lưu".
- QR là mã tra cứu thẻ, không chứng minh danh tính người cầm thẻ. GLV đối chiếu
  tên trên màn hình; thẻ sai lớp hoặc không hợp lệ không được ghi điểm danh.

## 3. Mô hình dữ liệu (Postgres + Drizzle)

Thực thể: `users` (cờ `is_grade_head`, `grade_id` = khối của tài khoản), `school_years`, `terms`, `grades`,
`classes`, `class_catechists`, `students` (tên thánh, họ tên, ngày sinh, SĐT phụ huynh,
ghi chú, `active`), `seating_plans`, `seat_assignments`, `sessions`, `attendance`.

### Sơ đồ băng ghế
```
seating_plans.layout = [
  { id, items: [ {type:"bench", id, seats:2..4}, {type:"gap", id}, ... ] },
  ...
]
```
- Băng có `id` cố định (uuid). Ghế xác định bởi `(benchId, seatIndex)`.
- `seat_assignments(plan_id, bench_id, seat_index, student_id)`; duy nhất theo
  `(plan_id, bench_id, seat_index)` và theo `(plan_id, student_id)`.
- Quy tắc kiểm tra (hàm thuần, `src/lib/seating`): 2–4 ghế/băng; tối đa 12 hàng,
  8 băng/hàng; một em một ghế/sơ đồ; xóa băng → các em trong băng về "chưa xếp chỗ".
- Mỗi lớp có nhiều sơ đồ, đúng 1 sơ đồ đang dùng (`is_active`).
- Điểm danh lưu theo `(session_id, student_id)`, **không** lưu theo ghế, nên đổi sơ đồ
  không làm sai lịch sử.

> Thiếu nhi chỉ bị ẩn (`active=false`), không xóa cứng. Migration QR chỉ **thêm** cột/bảng,
> không đổi ý nghĩa dữ liệu và 4 trạng thái hiện có.

### Dữ liệu bổ sung cho mốc QR (tối thiểu)

- `students.qr_token`: chuỗi ngẫu nhiên 32 ký tự hex (≥ 128 bit), **duy nhất**, tự sinh
  bằng database khi tạo em và khi chạy migration cho các em đã có. **Lưu trực tiếp**
  (không hash) để in lại thẻ bất cứ lúc nào. Cấp lại mã = ghi mã mới cho đúng một em,
  thẻ cũ vô hiệu ngay. Mã chỉ dùng được khi người quét đã đăng nhập là GLV có quyền
  ghi lớp đó. Nội dung QR là `dd1.<qr_token>` (tiền tố để loại nhanh mã không phải của
  app); không chứa tên, ngày sinh, SĐT hay quyền.
- `attendance.last_event_id` (uuid, nullable): lượt quét gần nhất đã đổi bản ghi này.
  Mọi đường ghi thủ công/hàng loạt hiện có đặt lại cột này về `NULL`, nhờ đó hoàn tác
  biết khi nào đã có sửa mới hơn. Đây là thay đổi duy nhất lên đường ghi cũ.
- `attendance_scans` (nhật ký + chống ghi trùng): `event_id` UUID khóa chính, `kind`
  (`scan` | `manual` | `undo`), `session_id`, `student_id`, `actor_id`, `mode`
  (`present` | `late`), `prev_status`/`prev_reason` (trạng thái trước), `new_status`,
  `result` (`applied` | `noop`; lượt bị từ chối không được lưu vì kết quả tính lại được y hệt), `error_code` an toàn, `captured_at`
  (giờ máy khách, chỉ để đối chiếu), `received_at`, `target_event_id` (với `undo`).
  Một `event_id` gắn với payload và actor bất biến: gửi lại đúng payload trả đúng
  kết quả cũ; gửi lại với payload hoặc actor khác bị từ chối (409), không ghi đè.
- Không có bảng version/outbox/receipt riêng: ghi điểm danh và `attendance_scans`
  nằm trong **một transaction**, nên "đã nhận" và "đã lưu" là cùng một thời điểm.

## 4. Luồng điểm danh

- **Mở buổi:** nút "Điểm danh hôm nay"; tạo buổi khi cần (không sinh sẵn cả học kỳ);
  chọn ngày khác để điểm danh bù; công tắc nghỉ lễ.
- **Mặc định là chưa điểm danh.** Nút "Tất cả có mặt" chỉ điền cho em chưa điểm danh.
- **Chế độ sơ đồ:** chạm = đổi qua lại có mặt ⇄ vắng không phép; nhấn giữ (hoặc chạm huy
  hiệu) = bảng chọn vắng có phép / đi muộn + lý do. Em chưa xếp ghế ở khay "Chưa xếp chỗ".
  Ghế chưa gán em thì khóa.
- **Chế độ checklist:** mỗi em một dòng, nút Có mặt / Vắng / ⋯. Dùng chung dữ liệu với sơ đồ.
- **Lưu tự động** từng lần chạm; đầu trang hiện "Đã điểm danh x/y". Lỗi lưu → ghế viền đỏ +
  nút thử lại, không bỏ qua im lặng.
- **Cảnh báo tức thời:** huy hiệu cập nhật ngay khi chạm, đã tính cả buổi đang mở.
- **Sửa buổi cũ:** GLV của lớp sửa được; lưu `updated_by`, `updated_at`; không có luồng duyệt.
- Mất mạng: báo lỗi rõ ràng (offline nằm ngoài phạm vi).

### 4.1. Quét QR liên tục

1. GLV mở buổi và bấm **Quét QR**. Chỉ bật camera sau thao tác người dùng; giữ một
   camera stream trong cả phiên quét, tắt khi thoát. Không điều hướng tới và không mở
   URL bất kỳ có trong QR.
2. **Chế độ quét** là công tắc lớn, luôn nhìn thấy: **Có mặt** (mặc định) / **Đi muộn**.
   Khi lớp bắt đầu, GLV gạt sang Đi muộn thì các thẻ quét sau đó ghi Đi muộn. Chế độ
   hiện đang bật phải luôn rõ ràng (màu + chữ), và mỗi kết quả ghi rõ đã ghi trạng
   thái nào. Không có quy tắc tự suy ra "muộn" từ giờ máy.
3. Khi mở màn quét, tải **bảng tra** của đúng lớp (chỉ cho người có quyền ghi): mỗi em
   đang hiện gồm `studentId`, họ tên, tên thánh, `qr_token`, trạng thái hiện có và số buổi
   vắng không phép trước đó (`priorUnexcused`, để tính cảnh báo ở máy khách). Giữ trong bộ nhớ, xóa khi
   thoát, `no-store`, không lưu ở thiết bị lâu dài. Quyền và hiệu lực thẻ luôn do máy
   chủ quyết định, bảng tra chỉ để hiện tên tức thì.
4. Decoder đọc mã → **tra tên ngay trong bộ nhớ** và hiện tên lớn (kèm tên thánh khi
   cần phân biệt) → tạo `event_id` → áp dụng quy tắc §4.2 trên trạng thái hiện có để cập
   nhật giao diện lạc quan → gửi nền lên máy chủ. Camera nhận mã tiếp theo ngay, không
   chờ phản hồi, không tải lại trang, không mở lại camera, không modal chặn sau mỗi
   thẻ. Chặn phát hiện lặp **của đúng mã đang còn trong khung**, không dùng khóa thời
   gian chung làm chậm thẻ tiếp theo. Mã không có trong bảng tra: tải lại bảng tra
   **một lần** (giới hạn tần suất, phòng khi vừa thêm em hoặc cấp lại thẻ) rồi mới báo
   "Thẻ không dùng được cho lớp này"; không gửi mã lạ lên máy chủ để ghi, không tiết lộ tên.
5. Máy chủ xử lý **đồng bộ trong một transaction**: xác thực, kiểm quyền ghi lớp, kiểm
   buổi chưa nghỉ lễ, tìm em theo `qr_token` trong đúng lớp của buổi (đang hiện), áp dụng
   quy tắc, ghi `attendance` + `attendance_scans`, rồi trả kết quả cuối cùng trong cùng
   phản hồi (`applied` / `noop` / `needs_confirm`, hoặc lỗi nghiệp vụ, kèm trạng thái hiện tại
   của em). Không poll, không trạng thái trung gian ở máy chủ. Máy khách tự tính cảnh báo
   từ `priorUnexcused` và trạng thái mới.
6. Khi phản hồi về, lượt đó chuyển `saved` (hoặc `rejected`/`needs_confirm`) theo đúng
   `event_id`. Hiện tổng `đã lưu / đang gửi / cần xử lý` và các lượt gần đây (tên + kết quả).
   Giao diện lạc quan không được coi là đã lưu.
7. **Tìm bằng tên** luôn sẵn: chọn đúng em từ roster rồi xác nhận ngắn, dùng cùng đường
   gửi, cùng giao thức `event_id`, `kind = manual`.
8. Cuối buổi tách **em chưa điểm danh** và **lượt chưa lưu/cần xử lý**. Không tự chuyển
   em chưa điểm danh thành vắng; không báo xong nếu còn lượt chưa rõ kết quả.

Nhiều lượt có thể gửi **song song**; thứ tự chỉ cần giữ cho cùng một em (mỗi em một
hàng gửi tuần tự). Còn lượt chưa gửi hoặc hoàn tác chưa xác nhận → cảnh báo và lựa chọn ở
lại khi thoát; không hứa giữ dữ liệu qua đóng tab/tải lại. Hàng gửi có giới hạn (mặc định
50 lượt đang chờ); vượt giới hạn thì tạm ngừng nhận thêm và nói rõ nguyên nhân. Lượt luôn
gắn với buổi/lớp gốc; đổi lớp hoặc ngày không đổi đích của lượt còn chờ.

### 4.2. Quy tắc khi quét và xử lý lỗi

Khi quét một thẻ hợp lệ của em trong lớp, tùy trạng thái hiện có của em trong buổi:

| Trạng thái hiện có | Quét ở chế độ Có mặt | Quét ở chế độ Đi muộn |
|---|---|---|
| Chưa điểm danh | Ghi **Có mặt** | Ghi **Đi muộn** |
| Có mặt | Không đổi, báo "Đã điểm danh" | Không đổi (không hạ Có mặt thành Đi muộn), báo "Đã có mặt" |
| Đi muộn | Không đổi, báo "Đã ghi đi muộn", **không hỏi** | Không đổi, báo "Đã ghi đi muộn" |
| Vắng có phép / Vắng không phép | **Hỏi xác nhận**: đổi sang Có mặt hoặc Đi muộn (mặc định theo chế độ quét) | giống bên trái |

Quét bình thường không cần xác nhận từng em. Khi đổi từ trạng thái vắng, lượt đó lưu
trạng thái trước để hoàn tác.

| Tình huống lỗi | Hành vi bắt buộc |
|---|---|
| Không đọc được, thẻ mờ/rách/chói | Không ghi; giữ camera, gợi ý ngắn; tìm tên hoặc bật đèn nếu thiết bị hỗ trợ |
| Camera bị từ chối/không khả dụng | Hướng dẫn cấp quyền camera và chuyển sang tìm tên; không khóa màn điểm danh |
| Mã không hợp lệ / thẻ đã bị thay mã / em bị ẩn | Không ghi; thông báo ngắn "Thẻ không dùng được"; không tự mở URL |
| Thẻ thuộc lớp khác | Không ghi, không tự chuyển lớp; không lộ tên/lớp ngoài quyền đọc |
| Quét lặp khi lượt trước đang gửi | Hiện lượt đang xử lý; không tạo thao tác đảo trạng thái |
| Thẻ hợp lệ nhưng nhầm em trong cùng lớp | Hiện tên lớn; **Hoàn tác** gắn với lượt đó, rồi quét/chọn đúng em |
| Mạng lỗi/timeout, chưa rõ máy chủ đã nhận chưa | Gửi lại **cùng `event_id` và payload**; máy chủ trả kết quả cũ nếu đã xử lý; không báo mã không hợp lệ |
| Lỗi máy chủ tạm thời (5xx) | Lượt ở `failed`, giữ trong danh sách "Cần xử lý" với nút **Thử lại** (cùng `event_id`); không báo thành công giả |
| Buổi nghỉ lễ / GLV mất quyền / buổi đã đổi | Máy chủ từ chối, không ghi; giao diện báo lỗi phù hợp, không retry |

Màu, chữ và biểu tượng cùng diễn đạt trạng thái; âm/rung chỉ hỗ trợ, cho phép tắt.
`captured_at` được lưu để đối chiếu nhưng giờ máy khách không phải nguồn tin tuyệt đối.

### 4.3. Hoàn tác đúng lượt

- Mỗi lượt gần đây có nút **Hoàn tác** riêng, gắn với `event_id` của lượt đó (không phải
  "thao tác cuối của cả lớp").
- Hoàn tác chỉ thực hiện khi `attendance.last_event_id` vẫn là lượt đó (chưa có sửa nào
  mới hơn): khôi phục `prev_status`/`prev_reason`; nếu trước đó chưa điểm danh thì
  **xóa** bản ghi. Không bao giờ biến Có mặt thành Vắng.
- Nếu đã có sửa mới hơn: trả `conflict`, **không** ghi đè; mở trạng thái hiện tại để GLV
  kiểm tra. Lượt no-op/trùng không có gì để hoàn tác.
- Hoàn tác là một lượt `undo` có `event_id` riêng (gửi lại được, idempotent); nhật ký
  không bị xóa. **Chọn đúng em** là một lượt quét/chọn mới, tách khỏi kết quả hoàn tác em cũ
  (hiển thị riêng từng kết quả).

### 4.4. Bổ sung UX lưu và kiểm tra cuối buổi (2026-10-12)

Phần này là yêu cầu bổ sung cần triển khai theo Mốc 8 của plan, không mô tả tính năng
đã có. Điểm danh hiện tại đã lưu từng thao tác; không tạo một nút "Lưu tất cả" khiến
người dùng tưởng dữ liệu chỉ được lưu cuối buổi. Quy tắc áp dụng chung cho sơ đồ,
danh sách, QR, tìm tên, ghi hàng loạt, hoàn tác và gửi lại.

**Dữ liệu phải có thể đọc lại từ máy chủ:** lớp/ngày/học kỳ/buổi nghỉ lễ; từng em với
trạng thái/lý do/người cập nhật/thời gian cập nhật; nhật ký QR/chọn tên/hoàn tác và ID
để đối chiếu gửi lại. Tiến độ và tổng kết được tính từ điểm danh hiện hành trong DB,
không suy ra từ số lượt quét trong bộ nhớ. Kết quả đã lưu còn khi mở lại buổi hoặc
đăng nhập từ thiết bị có quyền; lượt chưa tới máy chủ không có bảo đảm đó.

#### Lưu tự động và kết quả chưa rõ

- Phản hồi tại thiết bị: **Đã đọc thẻ · Đang lưu**, **Đang lưu thay đổi**,
  **Đã lưu**, **Chưa xác nhận được kết quả** hoặc **Cần xử lý**. Không ghi "Đã ghi"
  hoặc "Đã lưu" trước khi API xác nhận commit. Âm/rung đọc mã không chứng minh đã lưu.
- Có thể cập nhật lạc quan để thao tác nhanh, nhưng phải có chỉ báo pending/unknown
  riêng. Số em **đã lưu** chỉ tính dữ liệu máy chủ xác nhận; số lượt đang gửi được
  hiển thị riêng. Quét trùng/no-op không tăng số em; mở lại scanner không đưa tổng
  buổi về 0. Nếu cần đếm lượt, ghi rõ **Lượt quét trong lần này**.
- Timeout/5xx có thể xảy ra sau commit. Tra endpoint kết quả theo event ID trước
  khi coi lượt là chưa lưu; nếu chưa rõ thì vẫn dùng **Chưa xác nhận**, không tự kết
  luận dữ liệu đã mất. Gửi lại QR/undo bằng cùng event ID/payload, không tạo lượt mới.
- Ghi tay thành công nhưng tính cảnh báo sau đó lỗi không được coi là ghi thất bại.
  Tách kết quả commit khỏi phần tính cảnh báo; refresh dữ liệu phụ sau hoặc đối chiếu
  lại trạng thái hiện hành. Mọi mutation cần kết quả đủ để xác nhận từng thao tác;
  retry không đảo trạng thái hoặc ghi đè chỉnh sửa mới.
- Dừng camera/tìm tên/chuyển chế độ ngay trong màn hiện tại giữ việc gửi nền. Rời
  trang bằng Xong, link trong tổng kết, tab lớp, điều hướng dưới, quay lại, đổi ngày
  hoặc đóng/reload đều phải qua cơ chế bảo vệ phù hợp. Không chỉ dựa vào beforeunload
  cho điều hướng Next.js. Không chặn rời trang khi đã lưu và không còn vấn đề cần giải quyết.
- Có lỗi thì giữ tên và hành động tại đúng lượt: **Thử lại**, **Kiểm tra kết quả**,
  **Sửa trạng thái**. Không có nút "Bỏ qua" khiến kết quả chưa rõ biến thành đã xử lý:
  trước khi bỏ, đối chiếu máy chủ và nói rõ chỉ bỏ yêu cầu ở thiết bị, không xóa điểm
  danh đã lưu. Rời khi chưa rõ phải nói **Có lượt chưa xác nhận**, không khẳng định
  tất cả lượt đó chưa được máy chủ lưu.

#### Luồng kết thúc tiện cho GLV

1. **Xong** trong scanner đổi nhãn thành **Dừng quét** hoặc **Về bảng điểm danh**:
   chỉ kết thúc việc dùng camera, không đồng nghĩa cả lớp đã kiểm tra xong.
2. Một hành động chính **Kiểm tra & hoàn tất** trên board (dùng được từ QR) dừng
   nhận thêm mã, chờ/đối chiếu các lượt hiện tại rồi đọc tổng kết mới từ máy chủ.
3. Màn kiểm tra có bốn nhóm: **đã lưu**, **em chưa điểm danh**, **lượt đang lưu/chưa rõ**,
   **cần xử lý**. Chạm nhóm chưa ghi/lỗi để tới đúng em; tìm tên, sửa và thử lại ngay
   tại đây, không chỉ liệt kê tên rồi buộc người dùng quay qua nhiều màn.
4. Có thể đánh vắng nhóm em chưa ghi bằng thao tác rõ **Đánh vắng các em còn lại**:
   xem tên, chọn vắng không phép/có phép và xác nhận phạm vi. Chỉ ghi em thực sự vẫn
   chưa có trạng thái trên máy chủ; giữ các em vừa được người khác ghi/quét. Không
   tự điền vắng khi đóng scanner, hết giờ, mất mạng hoặc bấm hoàn tất.
5. Không có pending/unknown/lỗi cần xử lý và đủ trạng thái cho roster được kiểm tra
   thì cho **Hoàn tất kiểm tra**. Khi còn vấn đề, nút chính đưa tới việc cần làm;
   **Quay lại sau** vẫn cho rời với giải thích dữ liệu nào đã lưu, phần nào chưa rõ.
   "Quay lại sau" không đánh dấu buổi đã hoàn tất hoặc hứa giữ lượt chỉ ở thiết bị.
6. Máy chủ kiểm quyền và điều kiện trong transaction, chốt snapshot/revision hợp lệ
   để lưu người/thời điểm kiểm tra (ví dụ `sessions.reviewed_at`, `reviewed_by`). Kết
   quả đọc lại từ DB có ngày/lớp, có mặt, đi muộn, vắng có phép/không phép, số chưa ghi,
   thời điểm đối chiếu và người kiểm tra. Bấm đúp/gửi lại không tạo một buổi khác.
   Cùng request/buổi/revision đã xác nhận trả lại cùng review receipt, giữ nguyên
   người/thời điểm; mất response không tạo xác nhận mới. Chỉ re-review revision mới
   sau thay đổi mới được cập nhật receipt.
7. Màn xác nhận ngắn **Đã lưu và kiểm tra xong buổi này**, nút **Về lớp** và tùy chọn
   **Xem tổng kết**. Không bắt tải Excel hoặc bấm thêm một nút Lưu. Nếu mất response
   hoàn tất, tra metadata và tổng kết trước khi báo chưa hoàn tất.

Ví dụ nội dung khi tất cả đã được đối chiếu:

```
Thêm sức 1 · Buổi 12/10
Đã lưu 32/32 em
27 có mặt · 2 đi muộn · 1 vắng có phép · 2 vắng không phép
Không còn lượt đang gửi hoặc cần xử lý trên thiết bị này
Đã đối chiếu máy chủ lúc 09:45
[Hoàn tất kiểm tra]
```

**Mở lại và sửa sau kiểm tra:** lịch sử lớp hiện **Đang điểm danh / Đã kiểm tra xong /
Đã sửa, cần kiểm tra lại / Nghỉ lễ** theo dữ liệu bền. Mở buổi dở bằng **Tiếp tục điểm
danh**, ưu tiên nhóm chưa ghi. Sửa sau xác nhận vẫn được theo quyền hiện hành; mọi
đường ghi thành công thay đổi trạng thái, lý do, xóa/hoàn tác, ghi hàng loạt hoặc
đánh dấu/bỏ nghỉ lễ phải vô hiệu xác nhận cũ hoặc đánh dấu cần
kiểm tra lại, không khóa buổi hoặc âm thầm giữ nhãn đã hoàn tất. Kiểm tra lại rồi mới
cập nhật thời điểm/người xác nhận. Báo xung đột nếu dữ liệu đổi từ thiết bị khác trong
lúc chốt; không hứa biết các lượt chưa gửi từ thiết bị khác hoặc dữ liệu đã bị khóa.

Theo dõi revision/snapshot để chống race là invariant; field và lock order cụ thể do
Task 23 chốt, tránh thêm workflow duyệt nhiều bước. Lịch sử roster đổi khi em chuyển/
ẩn là vấn đề riêng: cần kiểm tra và đề xuất snapshot roster nếu sản phẩm cần tổng
lịch sử bất biến; chưa mặc định mở rộng sang lưu toàn bộ hồ sơ hoặc ảnh thẻ.

## 5. Màn hình và điều hướng

Thanh dưới cùng: **Lớp của tôi · Cần chú ý · Khối** (chỉ trưởng khối) **· Tài khoản**.

| Màn hình | Nội dung |
|---|---|
| Đăng nhập | Email + mật khẩu; không đăng ký công khai |
| Lớp của tôi | Thẻ lớp: số em, buổi gần nhất, số em cần chú ý, nút điểm danh |
| Trang lớp | Tab: Điểm danh · Thiếu nhi · Sơ đồ · Thống kê |
| Quét QR | Camera liên tục, **công tắc Có mặt/Đi muộn**, tên lớn, số đã lưu/đang gửi/cần xử lý, lượt gần đây với Hoàn tác, Tìm bằng tên |
| In thẻ QR | Trang trong tab Thiếu nhi (GLV có quyền ghi): lưới thẻ A4 (tên, tên thánh, lớp, QR), in/lưu PDF bất cứ lúc nào; "Cấp lại mã" cho từng em có xác nhận |
| Kiểm tra cuối buổi | Em chưa điểm danh và lượt cần xử lý tách riêng |
| Kiểm tra & hoàn tất (bổ sung §4.4) | Đối chiếu tổng kết từ DB, xử lý ngay em/lượt còn thiếu, xác nhận người và thời điểm kiểm tra; mở lại tiếp tục hoặc xem tổng kết |
| Thiếu nhi | Thêm/sửa, import CSV (xem trước, lỗi theo dòng), ẩn em |
| Sơ đồ | Editor hàng/băng/ghế, gán em, nhiều sơ đồ, chọn sơ đồ đang dùng |
| Thống kê | Theo học kỳ, bảng từng em, huy hiệu, xuất Excel |
| Cần chú ý | Em chạm ngưỡng, gom theo lớp; trưởng khối thấy cả khối |
| Khối | Tổng quan lớp trong khối: tỉ lệ chuyên cần, số em cảnh báo |

## 6. Phân quyền

Kiểm tra ở server qua một hàm duy nhất `canAccess(user, classId, "read" | "write")`
(`src/lib/access`).

- **GLV:** đọc và ghi lớp được gán.
- **Trưởng khối:** đọc mọi lớp trong khối; ghi chỉ ở lớp được gán (muốn ghi lớp khác thì
  tự gán mình vào lớp đó). Quản lý lớp, tài khoản GLV, việc gán GLV, đặt lại mật khẩu
  trong khối của mình.
- Tài khoản trưởng khối đầu tiên, năm học, học kỳ: tạo bằng script seed một lần.
- Không đủ quyền và lớp không tồn tại cùng trả 404 / cùng một thông báo "không tìm thấy" (không tiết lộ lớp có tồn tại hay không).
- QR: chỉ người có **quyền ghi** lớp mới tải bảng tra mã, xem trang in thẻ, quét, hoàn tác
  và cấp lại mã. Trưởng khối chỉ đọc không thấy mã.

## 7. Kiến trúc

- `src/lib/*`: hàm thuần, không đụng DB, trả về bản sao mới (`attendance`, `seating`,
  `access`, `import`, và quy tắc quét §4.2 dưới dạng hàm thuần dùng chung cho máy khách
  lẫn máy chủ).
- `src/db/*`: schema + truy vấn gom theo nhóm (repository).
- `src/app/*`: route. Phần lớn Server Component; Client Component cho editor sơ đồ,
  màn hình điểm danh và scanner.
- Thao tác ghi thủ công dùng Server Action: xác thực → `canAccess` → validate zod → ghi DB;
  trả `{ok:true,data}` hoặc `{ok:false,error}`.
- Mốc QR dùng **route handler mỏng** (nhận lượt quét/chọn tên/hoàn tác, trả bảng tra,
  tra kết quả theo lô `event_id` khi timeout) gọi cùng service và `guardClass`, không
  bỏ qua xác thực. Route POST dùng cookie nên có kiểm tra Origin/CSRF riêng (không hưởng
  kiểm tra của Server Action), giới hạn kích thước body và rate. Kết quả private/no-store.
- **Ưu tiên độ trễ (mục tiêu hàng đầu của mốc QR):**
  - Cảm nhận tức thì nằm ở máy khách: bảng tra nạp sẵn, hiện tên ngay, cập nhật lạc quan,
    gửi nền song song, camera không bao giờ chờ máy chủ.
  - Đường ghi trên máy chủ gọn: một truy vấn lấy buổi + quyền ghi + lượt trùng, một truy
    vấn lấy em + trạng thái hiện có, rồi ghi `attendance` và `attendance_scans` trong một
    transaction (đường ghi cũ có khoảng 6–7 truy vấn nối tiếp), không `revalidate` toàn
    trang. Mục tiêu p95 xử lý máy chủ ≤ 100ms khi app và DB cùng vùng; nếu đo không đạt thì
    gộp thêm truy vấn bằng join/CTE trước (Task 20).
  - **Vùng chạy của ứng dụng và database phải trùng nhau** (và dùng kết nối giữ sẵn/pool
    phù hợp nhà cung cấp). Lệch vùng làm mỗi truy vấn tốn 100–200ms; đây là nghi vấn số
    một và phải đo trước.
  - Không dùng Redis/queue/worker ở máy chủ ở pha này: với một lớp 25–40 em (dưới 1
    lượt/giây) chúng thêm một vòng mạng và chờ kết quả, làm thời gian tới "đã lưu" dài
    hơn, đồng thời cần hạ tầng riêng. **Điều kiện xét lại:** nếu sau khi tối ưu truy vấn và
    vùng chạy mà p95 thời gian xử lý máy chủ cho tải 30 lượt/40 em vẫn vượt 300ms hoặc có
    nhiều GLV quét cùng lúc gây nghẽn đo được, thì cân nhắc hàng chờ chạy trên Postgres
    trước, Redis chỉ là phương án sau cùng.
- Next.js (App Router, TypeScript, Tailwind), Postgres hosted (Neon/Supabase), Drizzle,
  session stateless `jose` + cookie `httpOnly` (cookie chỉ chứa `userId`, quyền đọc lại từ DB mỗi request; theo hướng dẫn xác thực của Next 16), deploy Vercel. PWA ở mốc cuối.

## 8. Xử lý lỗi và bảo mật

- Validate ở biên bằng zod, thông báo tiếng Việt dễ hiểu.
- Import báo lỗi theo từng dòng; các dòng hợp lệ dùng được sau khi người dùng xác nhận.
- Lỗi DB ghi log chi tiết ở server, người dùng chỉ thấy thông báo chung.
- bcrypt cho mật khẩu, giới hạn đăng nhập sai, secret chỉ ở biến môi trường, không commit
  `.env*`.
- **QR:**
  - `qr_token` ≥ 128 bit ngẫu nhiên từ nguồn mật mã của database, duy nhất, chỉ xuất hiện
    ở trang in thẻ và bảng tra dành cho người có quyền ghi lớp; không có trong danh sách
    thiếu nhi, thống kê, xuất Excel hay log. Mã chỉ có tác dụng khi đã đăng nhập đúng quyền,
    nên nhặt được thẻ không điểm danh được cho ai.
  - Giới hạn payload (một mã ngắn), số lượt/phút theo tài khoản (mặc định đủ cho quét liên
    tục khoảng 120 lượt/phút), kích thước lô tra kết quả (≤ 50 `event_id`).
  - Quyền và `student` luôn do máy chủ suy ra từ phiên đăng nhập và mã; không tin
    `studentId`/quyền do máy khách tự khai ở đường quét (đường "tìm tên" chỉ nhận
    `studentId` thuộc đúng lớp của buổi và vẫn kiểm quyền ghi).
  - Thẻ lớp khác/mã lạ/thẻ đã đổi mã đều trả cùng một thông báo, không lộ danh tính.
- **Dependency:** gói `xlsx` trên npm đã cũ và có lỗ hổng đã biết → gỡ khỏi `package.json`.
  Import chỉ nhận **CSV** (tự parse, không cần thư viện); **xuất Excel** dùng `exceljs`.
  Mốc QR thêm: thư viện giải mã QR chạy trên trình duyệt (ưu tiên zxing/WASM vì
  `BarcodeDetector` không có trên iOS Safari) và thư viện sinh mã QR phía máy chủ; chọn cụ
  thể và duyệt gói ở Task 15.

## 9. Kiểm thử (TDD, ≥ 80% coverage)

- **Unit:** `warning` (đã xong, 8 test), `seating`, `access`, parse import.
- **Integration:** Server Action trên database test riêng, gồm các ca bị từ chối quyền.
- **E2E (Playwright)** ở 375px và 768px: đăng nhập → mở buổi → điểm danh bằng sơ đồ →
  thấy cảnh báo → xem ở "Cần chú ý"; một luồng kiểm tra phân quyền giữa hai GLV.
- **QR unit/integration (PGlite + Postgres thật cho các ca đồng thời):** parse `dd1.<mã>`;
  bảng quy tắc §4.2 đủ mọi ô (hàm thuần dùng chung); mã sai lớp, em bị ẩn, mã đã đổi;
  idempotency (cùng `event_id` cùng payload → cùng kết quả; khác payload/actor → 409; 5
  yêu cầu giống hệt song song → một bản ghi); hoàn tác khi `last_event_id` còn đúng, khi
  có sửa mới hơn (conflict), khi trước đó chưa điểm danh; ghi thủ công đặt lại
  `last_event_id`; buổi nghỉ lễ; mất quyền giữa chừng; giới hạn tốc độ; bảng tra chỉ cho
  người có quyền ghi.
- **QR E2E:** quét 30 thẻ liên tục bằng nguồn video giả hoặc cầu nối đưa mã đã giải vào
  (không phụ thuộc camera thật), mã hỏng/sai lớp/lặp/nhầm người, chế độ Đi muộn, camera
  bị từ chối, tìm tên, timeout rồi gửi lại cùng `event_id`, rời trang còn lượt chờ.
  Kiểm thử race bằng barrier có kiểm soát, không dùng sleep ngẫu nhiên.
- **Hiệu năng (đo, không đoán):** giải mã → hiện tên; thời gian máy chủ xử lý một lượt
  (median/p95) với số truy vấn; vòng mạng điện thoại → API; ảnh hưởng của lệch vùng
  app/database. Mục tiêu hiện tên ≤ 300ms từ lúc decoder đọc xong mã khi bảng tra đã sẵn;
  mục tiêu thời gian tới "Đã lưu" được **đặt sau khi có số đo cơ sở** ở Task 15; không cam kết
  cho mọi thiết bị hay tính từ lúc đưa thẻ vào camera.

## 10. Thứ tự triển khai

Mỗi mốc chạy được độc lập và qua code-reviewer (mốc 1 thêm security-reviewer).

1. Đăng nhập, `canAccess`, script seed.
2. Lớp và thiếu nhi, import CSV.
3. Editor sơ đồ băng ghế và gán chỗ (sửa schema theo mục 3).
4. Điểm danh (chế độ sơ đồ và chế độ checklist).
5. Thống kê, "Cần chú ý", trang Khối, xuất Excel.
6. PWA và chỉnh giao diện.
7. Mở rộng QR (đơn giản, ưu tiên độ trễ): đo cơ sở (số truy vấn, vùng app/DB, chọn thư viện
   giải mã/sinh QR) → migration `qr_token` + `last_event_id` + `attendance_scans` → in thẻ
   và cấp lại mã → API quét/hoàn tác/bảng tra (một transaction) → scanner + công tắc chế độ +
   tìm tên + tổng kết → kiểm thử, đo và vận hành.
8. Lưu và hoàn tất buổi: đối chiếu kết quả chưa rõ → bảo vệ điều hướng mọi chế độ →
   tổng kết authoritative + xác nhận kiểm tra bền → kiểm thử mở lại/lỗi/race.

## 11. Quyết định mốc QR (2026-10-12)

| Quyết định | Phương án đã cân nhắc và lý do |
|---|---|
| GLV quét thẻ từng em (không phải thiếu nhi tự quét) | Tự check-in cần định danh em và chống quét hộ; ngoài phạm vi |
| Mỗi em một mã ngẫu nhiên, lưu thẳng trong `students.qr_token` | Hash khiến in lại thẻ thành cấp mã mới làm hỏng các thẻ đã phát; mã chỉ có tác dụng khi đã đăng nhập đúng quyền nên lưu thẳng là chấp nhận được |
| Ghi đồng bộ trong một transaction, bỏ Redis/queue/worker | Mục tiêu là độ trễ: queue thêm vòng mạng và chờ kết quả, cần hạ tầng riêng; tải thực tế rất nhỏ. Xét lại chỉ khi số đo đòi hỏi |
| Độ trễ cảm nhận tới từ máy khách (bảng tra nạp sẵn, cập nhật lạc quan, gửi nền) | Camera không chờ máy chủ; "Đã lưu" xác nhận sau, theo từng `event_id` |
| Tối ưu truy vấn và vùng chạy app/DB là việc đo đầu tiên | Đường ghi cũ ~6–7 truy vấn nối tiếp; lệch vùng nhân độ trễ lên rất nhiều |
| Công tắc quét Có mặt / Đi muộn, không có quy tắc giờ tự động | Nhanh, GLV tự quyết mốc muộn, không cần cấu hình giờ lớp |
| Quét em đã Đi muộn: giữ nguyên, không hỏi | Quét lại thường là nhầm; hỏi mỗi lần làm chậm. Em đang Vắng thì hỏi vì đó là trường hợp em tới thật |
| Hoàn tác đúng lượt bằng `last_event_id`, chỉ khi chưa có sửa mới hơn | Tránh ghi đè sửa tay mới hơn; không cần bảng version cho mọi đường ghi |
| Tìm tên khi thẻ lỗi; giữ lịch sử gần đây | Không chặn cả lớp vì một thẻ lỗi; sửa được sau khi quét em tiếp theo |

Giả định: lớp khoảng 25–40 em, mobile-first, thử 30 thẻ/lượt, chưa có offline bền; số GLV
quét đồng thời, thiết bị/mạng chuẩn và vùng chạy sẽ được đo/chốt ở Task 15 trước triển
khai. Bản nháp màu/bố cục trong `docs/ui-draft/preview.png` là tham khảo; giao diện đã
triển khai (nhánh `feat/ui-redesign`, hướng "Rõ ràng") là chuẩn hiện hành, bản nháp không
thay thế nó.
