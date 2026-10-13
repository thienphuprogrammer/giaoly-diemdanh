# Đề xuất thiết kế lại UI/UX — Điểm danh Giáo lý

Ngày: 12/10/2026 · Nhánh tham chiếu: `feat/qr-attendance` · Trạng thái: **đề xuất, chưa triển khai**

Cơ sở: đọc mã giao diện hiện tại (`BottomNav`, `ClassTabs`, `ui/`, `attendance/AttendanceBoard`, `scan/ScanScreen`, trang Lớp của tôi), `docs/superpowers/specs/…-design.md` §4–§5 và `docs/ui-draft/`. **Chưa kiểm tra trên trình duyệt chạy thật**: trình duyệt tự động không khởi động được trên máy này, nên các nhận xét dưới đây là từ mã nguồn, cần xác nhận bằng ảnh chụp trên điện thoại 375px trước khi chốt.

---

## 1. Vấn đề hiện tại (từ mã)

Người dùng chính là GLV, dùng điện thoại, đứng trong lớp, thường có vài chục giây để điểm danh ~25–40 em. Các vấn đề chính:

| # | Vấn đề | Bằng chứng trong mã | Tác động |
|---|---|---|---|
| 1 | **Hai lớp điều hướng chồng nhau** trên điện thoại: thanh dưới 4 mục + thanh tab lớp 5 mục (Điểm danh, Thiếu nhi, Sơ đồ, Thống kê, Nhật ký). | `BottomNav.tsx`, `ClassTabs.tsx` | Tốn ~112px chiều cao cố định, 5 nhãn chữ trên 375px phải cuộn ngang; GLV ít khi cần Nhật ký/Thống kê. |
| 2 | **Đầu màn điểm danh quá nặng**: tiến độ, nút Quét QR, Tất cả có mặt, Đánh vắng còn lại, công tắc Buổi nghỉ lễ, khối Lễ, chọn Sơ đồ/Danh sách, rồi mới đến danh sách em. | `AttendanceBoard.tsx` (phần đầu ~100 dòng trước `SeatMap`/list) | Trên điện thoại chỉ thấy vài em đầu; hành động "bulk" và hành động hiếm (nghỉ lễ) nằm ngang hàng hành động thường dùng. |
| 3 | **Hành động hàng loạt có sức phá hủy nằm ở vị trí chính**: "Tất cả có mặt" là nút primary to; "Đánh vắng còn lại" luôn hiện. | `AttendanceBoard.tsx` | Dễ bấm nhầm; có xác nhận nhưng vị trí không tương xứng với mức rủi ro. |
| 4 | **Trạng thái đổi bằng "chạm để xoay vòng" + nhấn giữ** để mở lựa chọn. Chạm chỉ đổi Có mặt ⇄ Vắng không phép; Đi muộn và Vắng có phép phải nhấn giữ (`StudentButton`, `LONG_MS`) hoặc bấm dải tùy chọn nhỏ. | `toggle.ts`, `StudentButton.tsx` | Đi muộn/có phép (hai trạng thái gặp hằng tuần) bị giấu sau thao tác không hiển nhiên; người mới không biết có thao tác đó. |
| 5 | **Chế độ Sơ đồ là mặc định khi có sơ đồ**, ô ghế nhỏ, tên rút gọn; người dùng phải chạm đúng ô nhỏ trong lưới băng ghế. | `AttendanceBoard.tsx`, `SeatMap.tsx` | Tên dài/trùng khó nhận ra; vùng chạm dưới chuẩn 48px. Trong khi chế độ Danh sách đọc tên rõ hơn nhiều. |
| 6 | **Điểm vào lớp dài**: Lớp của tôi → thẻ lớp → Điểm danh (2 chạm) trước khi làm việc chính. Với GLV chỉ có một lớp, đây là bước thừa mỗi buổi. | `app/(app)/page.tsx` | Mỗi buổi thêm một bước; màn chủ không cho biết "hôm nay còn gì phải làm". |
| 7 | **Nhiều lớp shadow và sheet** (`shadow-bar`, `shadow-sheet`, `shadow-sm`) trái với quy ước flat đã ghi nhớ cho UI mới. | `globals.css`, `BottomNav`, `ScanScreen` | Không đúng quy ước; thêm thị giác nặng. |
| 8 | **Quét QR và điểm danh tay là hai thế giới**: quét ở màn toàn màn hình riêng, quay lại bảng phải đi qua "Xong" + hộp hỏi. | `ScanScreen.tsx`, `scan-return.ts` | Đúng về mặt dữ liệu nhưng nhiều bước chuyển màn; người dùng dễ lạc đường về bảng. |

Điểm mạnh cần giữ: tiến độ lưu rõ ràng ("Đang lưu / Đã lưu"), hoàn tác có thời hạn, cảnh báo vắng theo ngưỡng, chế độ chỉ đọc rõ, thông báo lỗi có "Thử lại", màn quét toàn màn hình với nút "Xong" ở đáy cho ngón cái, bộ token màu "Rõ ràng" có kiểm tương phản.

---

## 2. Nguyên tắc thiết kế

1. **Một việc chính trên mỗi màn.** Màn chính của GLV là "điểm danh hôm nay", không phải "trang lớp có 5 tab".
2. **Thao tác phổ biến nhất chỉ cần một chạm; thao tác hiếm nằm trong menu.**
3. **Không giấu thao tác thường dùng sau cử chỉ.** Mọi trạng thái điểm danh đều có nút nhìn thấy được trên hàng.
4. **Hành động có sức phá hủy hoặc hàng loạt đi kèm xác nhận và nằm trong menu "⋯"**, không chiếm chỗ đầu màn.
5. **Phẳng:** viền và nền, không đổ bóng; giữ bảng màu "Rõ ràng" hiện có để không làm lại toàn bộ.
6. **Cùng một mẫu cho mọi vai trò:** theo quy ước đã ghi nhớ, thành phần chung đặt trong `components/shared/`, trang theo vai trò chỉ là adapter.

---

## 3. Kiến trúc thông tin mới

### 3.1 Điều hướng toàn cục (thanh dưới, 3–4 mục)

| GLV | Trưởng khối (thêm) |
|---|---|
| **Hôm nay** (màn chủ mới) | **Hôm nay** |
| **Lớp** (danh sách lớp, thống kê, thiếu nhi) | **Lớp** |
| **Cần chú ý** | **Cần chú ý** |
| **Tài khoản** | **Khối** · **Tài khoản** (gộp vào 5 mục → tối đa 5, nên gộp "Tài khoản" vào menu góc trên) |

- Thanh dưới giữ **nhãn chữ + biểu tượng**, cao 56px (không 64px), không đổ bóng, viền trên 1px.
- Khi ở trong một lớp, **ẩn thanh dưới** và dùng thanh đầu có nút quay lại + tên lớp + 3 phân đoạn (xem 3.2). Lý do: tránh hai thanh chồng nhau (vấn đề 1).

### 3.2 Trong một lớp: 3 phân đoạn

- **Điểm danh** (mặc định) · **Thiếu nhi** · **Thống kê**.
- **Nhiều hơn** (menu ⋯ trên thanh đầu): Sơ đồ chỗ ngồi, In thẻ QR, Nhật ký, Cài đặt buổi.
- Lý do: Sơ đồ, In thẻ, Nhật ký là thao tác cấu hình hoặc tra cứu hiếm, không cần chiếm chỗ thanh tab.

### 3.3 Màn "Hôm nay" (thay "Lớp của tôi")

- Đầu màn: ngày + lời chào ngắn.
- **Mỗi lớp của hôm nay một thẻ lớn** có: tên lớp, giờ/ngày, trạng thái buổi (*chưa mở / đang điểm danh x/y / đã xong / nghỉ lễ*), và **một nút chính** theo trạng thái:
  - chưa mở → **Mở điểm danh**
  - đang điểm danh → **Tiếp tục điểm danh**
  - đã xong → **Xem buổi**
- Nút Quét QR nằm **trong** thẻ, cạnh nút chính (không tạo thêm thẻ).
- Dưới đó: mục **Cần chú ý** (em chạm ngưỡng) gom theo lớp, ẩn nếu không có.
- Với GLV chỉ có một lớp: thẻ đó là toàn bộ màn, nên một chạm đưa vào điểm danh.
- Quyền chỉ đọc: nút thành **Xem buổi**, có nhãn "Chỉ xem" rõ ràng.

---

## 4. Màn điểm danh (trọng tâm)

### 4.1 Bố cục điện thoại

```
┌───────────────────────────────┐
│ ←  Lớp Thiếu nhi A  · Hôm nay │  thanh đầu (56px)
│ Đã điểm danh 18/25 ▓▓▓▓▓░ 72% │  tiến độ 1 dòng, đính kèm chip "Đã lưu ✓"
├───────────────────────────────┤
│ [Danh sách] [Sơ đồ]     ⋯     │  phân đoạn + menu hành động
├───────────────────────────────┤
│ Nguyễn An          [✓][✗][M][P]│  mỗi em 1 hàng 56px
│ Trần Bình          [✓][✗][M][P]│
│ …                             │
├───────────────────────────────┤
│ [ 📷 Quét QR ]    [ 18 lượt… ]│  thanh đáy: hành động chính (cố định)
└───────────────────────────────┘
```

- **Hàng em:** tên lớn (≥ 17px, cho phép xuống dòng 2 dòng), tên thánh nhỏ dưới tên khi trùng tên.
- **Bốn nút trạng thái nhìn thấy được** trên mỗi hàng: **✓ Có mặt · ✗ Vắng KP · M Muộn · P Vắng có phép** (nhãn chữ đầy đủ ở dòng phụ trên điện thoại rộng). Mỗi nút ≥ 48px. Bấm nút đang chọn để bỏ trạng thái.
- Chạm vào tên mở chi tiết em (không đổi trạng thái).
- Nhấn giữ không còn là cách duy nhất để chọn trạng thái.

### 4.2 Thanh đầu và hành động phụ

- **⋯ (menu buổi)** chứa: *Tất cả có mặt* (xác nhận: "Đánh có mặt cho 7 em chưa điểm danh?"), *Đánh vắng còn lại* (xác nhận, có số lượng), *Buổi nghỉ lễ* (xác nhận; có trạng thái "Đang nghỉ lễ" rõ ràng sau khi bật), *Đi lễ* (khối lễ tách sang trang riêng nếu quá nặng).
- Trạng thái lưu chỉ là một chip nhỏ trên thanh tiến độ; lỗi thì hiện banner có "Thử lại" như hiện tại.
- Bỏ khối công tắc và nút lớn khỏi phần đầu.

### 4.3 Sơ đồ chỗ ngồi

- Chuyển từ **mặc định** sang **tùy chọn** (phân đoạn "Sơ đồ").
- Ô ghế tối thiểu 48px, hiện **tên đầy đủ** được rút gọn theo độ rộng, có tooltip/nhãn đọc được khi chạm.
- Cuộn ngang khi băng dài; chú thích gọn một dòng.

### 4.4 Lưu và sai sót

- Mỗi lần chạm lưu nền như hiện tại; chạm lại trạng thái cũ để bỏ.
- Hoàn tác (toast 5 giây) áp dụng cho *Tất cả có mặt* và *Đánh vắng còn lại*.
- Lỗi lưu: hàng em quay về trạng thái cũ + viền đỏ + "Thử lại" ngay trên hàng.

### 4.5 Quét QR

- Giữ màn toàn màn hình (đúng tinh thần hiện tại), nhưng:
  - Đầu màn một dòng: tên em vừa quét **lớn**, trạng thái lưu nhỏ bên dưới.
  - Đáy: công tắc **Có mặt | Đi muộn** (tách hai ô lớn, không gradient), nút **Xong** và **Tìm tên**.
  - Lượt gần đây: 3 dòng, mỗi dòng có Hoàn tác.
- Giảm chữ hướng dẫn; khi camera lỗi, nút **Tìm tên** nổi bật.

---

## 5. Thành phần dùng chung và flat design

- **Bỏ bóng:** `shadow-bar` ở thanh dưới và thanh quét → viền 1px. `shadow-sheet` giữ lại cho sheet (đặt viền trên + nền tối nhẹ thay bóng nếu muốn đúng hoàn toàn flat).
- **Chuẩn nhịp:** lề 16px trên điện thoại / 24px tablet; khoảng cách 8px; nút ≥ 48px; bo góc 10px (nút), 14px (thẻ).
- **Thành phần:** `StatusChoice` (bốn nút trạng thái), `AttendanceRow`, `ClassTodayCard`, `ActionMenu` (⋯), `SaveChip` — đặt trong `components/shared/` theo quy ước hiện có.
- Giữ Be Vietnam Pro (nội dung) + Lexend (tiêu đề) và bảng màu "Rõ ràng" hiện có.

## 6. Tablet và máy tính

- ≥ 1024px: thanh dưới chuyển thành **thanh trái** (icon + chữ), vùng nội dung rộng hơn, bảng điểm danh hai cột (danh sách + tóm tắt).
- Sơ đồ chỗ ngồi tận dụng chiều rộng, không cần cuộn ngang.
- Hiện không có giao diện laptop riêng trong phạm vi (spec §1); đề xuất này chỉ co giãn, không làm mới.

---

## 7. Quyết định cần bạn chốt

1. **Chạm để đổi trạng thái:** hiện tại chạm = Có mặt ⇄ Vắng KP (spec §4). Đề xuất có 2 lựa chọn:
   - **A (đề xuất):** giữ chạm = Có mặt ⇄ bỏ trống, và thêm nút trạng thái rõ ràng cho Vắng KP / Muộn / Có phép. Ít nhầm, phù hợp khi ít em vắng.
   - **B:** giữ chạm = Có mặt ⇄ Vắng KP như hiện tại, chỉ thêm nút Muộn/Có phép nhìn thấy được.
   Hai lựa chọn đổi hành vi chạm, nên cần bạn quyết; tôi không tự đổi quy tắc nghiệp vụ.
2. **Thanh dưới có "Tài khoản" hay chuyển vào menu góc?** (đề xuất: menu góc, để nhường chỗ cho "Hôm nay".)
3. **Trang Đi lễ** tách riêng hay giữ trong bảng điểm danh như hiện nay?
4. **Có áp dụng thay đổi cho vai trò trưởng khối ngay không**, hay làm GLV trước rồi đồng bộ sang khối (theo quy ước cross-role).

---

## 8. Lộ trình gợi ý

| Bước | Nội dung | Kiểm chứng |
|---|---|---|
| 0 | Chạy app dev và chụp ảnh 375px các màn hiện tại (đăng nhập, Lớp của tôi, Điểm danh, Quét) để làm mốc so sánh | Ảnh trong `docs/ui-redesign/before/` |
| 1 | Làm mẫu HTML tĩnh màn Hôm nay + Điểm danh (một file, không đổ bóng) để bạn duyệt trước khi sửa code | Bạn duyệt, rồi xác nhận ảnh so với bản vẽ |
| 2 | Bỏ bóng, gọn thanh dưới, ẩn thanh dưới trong lớp, gom tab lớp 3 + menu ⋯ | `pnpm run test`, `pnpm run lint`, `pnpm run build`; E2E `attendance.spec.ts` |
| 3 | Hàng em với 4 nút trạng thái, menu buổi ⋯, bỏ khối đầu nặng | Unit test `toggle.ts`/`remaining-absent`; E2E điểm danh; ảnh 375px |
| 4 | Màn Hôm nay với thẻ lớp và nút theo trạng thái | E2E `auth.spec.ts`/điều hướng; ảnh đối chiếu |
| 5 | Quét QR: rút gọn đầu/đáy, công tắc hai ô | `qr-camera.spec.ts`, `qr.spec.ts`; test trên điện thoại thật (checklist hiện có) |
| 6 | Tablet/desktop: thanh trái | Ảnh 768px và 1280px |

Mỗi bước là một commit logic; không push nếu chưa được phép.

---

## 9. Rủi ro

- Thêm nút trạng thái trên mỗi hàng làm tăng số phần tử DOM và chiều cao danh sách 25–40 em; cần đo cuộn mượt trên máy phổ thông.
- Đổi quy tắc chạm (mục 7.1) ảnh hưởng dữ liệu người dùng quen; cần thông báo và hướng dẫn.
- Tái cấu trúc điều hướng ảnh hưởng `useLeaveGuard` và `scan-return` (các hộp hỏi rời trang) — phải kiểm tra lại các đường dẫn.
- Chưa có số liệu thực tế về thời gian điểm danh hiện tại; nên đo trước và sau (thời gian từ mở buổi đến "Đã điểm danh 25/25") để biết cải thiện thật hay không.
