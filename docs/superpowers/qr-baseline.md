# QR: số đo cơ sở, thư viện và hợp đồng decoder

Ngày đo: 2026-10-12. Nhánh `feat/qr-attendance`.

## 1. Thư viện đã chọn

| Gói | Phiên bản | Vai trò |
|---|---|---|
| `barcode-detector` | 3.2.2 | Ponyfill Barcode Detection API (`barcode-detector/ponyfill`), chạy trên zxing-wasm; dùng ở trình duyệt |
| `zxing-wasm` | 3.1.3 (ghim chính xác) | Lõi giải mã WASM; là phụ thuộc trực tiếp để test import `zxing-wasm/reader` và để `scripts/copy-qr-wasm.mjs` tìm được file `.wasm` (pnpm không hoist) |
| `qrcode` | 1.5.4 | Sinh SVG ở máy chủ (mức sửa lỗi M, lề 1 module) |
| `@types/qrcode` | 1.5.6 (dev) | Kiểu |

Lý do chọn `barcode-detector` (không dùng `zxing-wasm` đơn lẻ):
- Cùng một file WASM (1 093 289 byte, khoảng 460 KB gzip), nên không tốn thêm dung lượng đáng kể: phần JS bọc thêm khoảng 59 KB thô (`dist/es/zxing-exported.js`, đã gồm keo nối `zxing-wasm`).
- Có giao diện giống `BarcodeDetector` gốc và nhận thẳng `HTMLVideoElement`, nên `decodeVideo(video)` chỉ vài dòng; sau này có thể đổi sang `BarcodeDetector` gốc của trình duyệt mà không đổi interface `QrDecoder`.
- README của gói nêu rõ mục đích là bù cho trình duyệt thiếu `BarcodeDetector` (Safari/iOS thiếu API gốc theo hiểu biết chung; **chưa kiểm chứng trên iPhone thật**). Trong Chromium headless của môi trường đo, `"BarcodeDetector" in window` là `false`, nên ponyfill đã thực sự được dùng.
- Rủi ro: `ZXING_WASM_VERSION` của ponyfill phải khớp file `.wasm` tự host. Vì vậy `zxing-wasm` được ghim `3.1.3` (đúng bản mà `barcode-detector@3.2.2` kéo vào, trong `node_modules/.pnpm` chỉ có một bản). Khi nâng cấp, chạy lại `pnpm qr:wasm` và commit file `.wasm` mới.

### Sai khác so với mã mẫu trong kế hoạch
1. Thêm `zxing-wasm` làm phụ thuộc trực tiếp (mã mẫu chỉ cài `barcode-detector qrcode`): test vòng tròn import `zxing-wasm/reader` và script chép wasm cần đường dẫn trực tiếp; nếu không pnpm không cho phép import gói bắc cầu.
2. `decoder.ts`: dùng `await prepareZXingModule({... fireImmediately: true})` (mã mẫu không `await`). Khi `fireImmediately: true` hàm trả về Promise của module Emscripten; không `await` thì lỗi tải wasm trở thành promise bị bỏ rơi và `createQrDecoder()` trả về trước khi wasm sẵn sàng. Chờ ở đây cho lỗi hiện ra đúng chỗ.
3. Tên export, đường dẫn `barcode-detector/ponyfill`, chữ ký `locateFile(path, prefix)` và đường dẫn `node_modules/zxing-wasm/dist/reader/zxing_reader.wasm` đều đúng như mã mẫu (đã xác nhận trong README/`.d.ts`).
4. `interface QrDecoder` giữ nguyên.

## 2. Số đo đường ghi hiện tại (`setStatus`)

Lệnh (từ gốc repo; `E2E_DATABASE_URL` trỏ container Postgres 16 cục bộ, tên DB chứa `e2e`, đã seed bằng `e2e/global-setup.ts`):

```bash
node --import tsx scripts/bench-baseline.ts
```

Môi trường: app (Node, postgres-js) và Postgres 16.15 cùng máy qua Docker `127.0.0.1:55432`, máy dev 20 luồng. N = 200 lượt `setStatus` mỗi lần chạy, 50 lượt `select 1`. Ba lần chạy liên tiếp:

| Chỉ số | Lần 1 | Lần 2 | Lần 3 |
|---|---|---|---|
| `select 1` p50 (ms) | 0.12 | 0.11 | 0.13 |
| `select 1` p95 (ms) | 0.23 | 0.23 | 0.25 |
| Số truy vấn mỗi `setStatus` | 6 | 6 | 6 |
| `setStatus` p50 (ms) | 3.27 | 3.22 | 3.42 |
| `setStatus` p95 (ms) | 19.20 | 6.57 | 14.37 |

Ý nghĩa: với DB cục bộ vòng mạng gần 0, nên p50 ≈ 6 truy vấn × xử lý thật của Postgres (~0,5 ms mỗi truy vấn). Đây là **sàn**, không phải số sản xuất. p95 dao động mạnh giữa các lần chạy (6,6 đến 19,2 ms) vì mẫu nhỏ và máy dùng chung; dùng p50 và số truy vấn làm chuẩn so sánh.

Ước tính (suy ra, KHÔNG phải số đo): nếu mỗi truy vấn tốn một vòng mạng RTT thì thời gian ≈ 6 × RTT + xử lý. Ví dụ RTT 20 ms thì khoảng 120 ms, vượt ngưỡng 100 ms; cho thấy việc app và DB cùng vùng, và việc giảm số truy vấn, quyết định kết quả.

### CHƯA LÀM: đo với database hosted và vùng thật
Không có Neon/Supabase trong môi trường này, nên số RTT thật, vùng Vercel và vùng DB **chưa được đo và chưa có số liệu**. Chủ dự án cần chạy từ máy chạy app hoặc từ một Vercel function (cùng vùng với app):

```bash
E2E_DATABASE_URL='<chuỗi kết nối một DB hosted dùng riêng cho đo, tên DB chứa "e2e", đã seed bằng e2e/global-setup.ts>' node --import tsx scripts/bench-baseline.ts
```

Ghi lại vào bảng dưới: `select 1` p50/p95, số truy vấn mỗi lượt (kỳ vọng 6), `setStatus` p50/p95, vùng Vercel project và vùng database. Nếu lệch vùng, đổi vùng function trong cài đặt Vercel (hoặc vùng DB) trước khi làm tiếp.

| Mục | Giá trị (điền khi đo) |
|---|---|
| Vùng Vercel project | _chưa đo_ |
| Vùng database | _chưa đo_ |
| `select 1` p50 / p95 | _chưa đo_ |
| Số truy vấn mỗi `setStatus` | 6 (đã đo, cục bộ) |
| `setStatus` p50 / p95 | _chưa đo_ |

Lưu ý script chỉ chạy khi tên DB chứa `e2e` (chống chạy nhầm) và xóa phiên `2026-01-01` của lớp thử sau khi đo.

## 3. Kiểm tra decoder trong trình duyệt

Cách làm (không có camera): một trang Next tạm `/qr-check` (đã xóa) sinh `dd1.<32 hex>` bằng `qrSvg`, vẽ lên `<canvas>`, đưa vào `<video>` qua `canvas.captureStream()`, rồi gọi `createQrDecoder()` và `decodeVideo(video)` 20 lần trong Chromium headless 156 (Playwright, `localhost`).

Kết quả:
- Giải mã đúng nguyên văn `dd1.0123456789abcdef0123456789abcdef`.
- `/zxing_reader.wasm` được tải từ chính origin (HTTP 200, `application/wasm`); không có request tới CDN.
- Khởi tạo `createQrDecoder()` (tải + biên dịch wasm, dev server, bộ nhớ đệm nguội): 45 ms. Giải mã mỗi khung hình: p50 ≈ 1,6 ms, tối đa ≈ 15,6 ms (QR 400×400 px, nền sạch, trên máy dev; điện thoại sẽ chậm hơn nhiều, chưa đo).
- Kích thước `public/zxing_reader.wasm`: 1 093 289 byte (gzip khoảng 459 965 byte).
- Test vòng tròn `src/lib/qr/qr-roundtrip.test.ts` (sinh bằng `qrcode`, đọc bằng `zxing-wasm/reader` trong Node): 2 test PASS (8 px/module và 4 px/module).

Chưa làm: **thử trên điện thoại thật (Chrome Android, Safari iOS) NOT done**; không có camera thật, ánh sáng thật, mã in ra giấy hay mã nhỏ trên màn hình khác. Cần làm trước khi tin chuyện quét thực địa.

Ghi chú vận hành: `src/proxy.ts` chuyển mọi đường dẫn không có cookie `session` về `/login`, và bộ lọc `matcher` không loại `/zxing_reader.wasm`. Vì máy quét chỉ chạy khi đã đăng nhập nên không ảnh hưởng, nhưng file wasm không tải được khi chưa đăng nhập; không đổi trong task này.

## 4. Ngưỡng quyết định

- Mục tiêu: p95 xử lý máy chủ của đường quét ≤ 100 ms khi app và DB cùng vùng.
- Đối chiếu: sau Task 18, đo lại bằng cùng script (đường quét thật). Nếu vượt ngưỡng: trước hết gộp truy vấn bằng join/CTE (hiện 6 truy vấn mỗi `setStatus`); chỉ cân nhắc hàng chờ trên Postgres khi vẫn không đạt.
- Nếu vùng app và DB lệch nhau, sửa vùng trước khi tối ưu truy vấn.
