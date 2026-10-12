# Điểm danh Giáo lý

Ứng dụng web (PWA) để giáo lý viên (GLV) điểm danh lớp giáo lý theo sơ đồ chỗ ngồi trên điện thoại, kèm thống kê học kỳ, danh sách cần chú ý và xuất Excel. Giao diện hoàn toàn bằng tiếng Việt.

Công nghệ: Next.js 16 (App Router), React 19, Postgres (Drizzle ORM), Tailwind CSS 4, Vitest, Playwright.

## Yêu cầu

- Node.js >= 22.9 (mã dùng `Map.groupBy`; script `seed` và `db:migrate` dùng `--env-file-if-exists`)
- pnpm 10
- Một database Postgres 16 (Neon, Supabase hoặc tự dựng)

## Biến môi trường

Sao chép `.env.example` thành `.env.local` rồi điền giá trị. Không commit các tệp `.env*`.

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | Chuỗi kết nối Postgres |
| `AUTH_SECRET` | Khóa ký phiên đăng nhập, tối thiểu 32 ký tự. Sinh bằng `openssl rand -base64 32` |

Các biến chỉ dùng cho `pnpm seed`: `SEED_EMAIL`, `SEED_PASSWORD` (tối thiểu 10 ký tự), và tùy chọn `SEED_NAME`, `SEED_GRADE`, `SEED_YEAR`, `SEED_T1_START`, `SEED_T1_END`, `SEED_T2_START`, `SEED_T2_END`.

## Cài đặt và chạy

```bash
pnpm install
pnpm db:migrate      # áp dụng migration vào DATABASE_URL (đọc .env.local)
```

Tạo tài khoản trưởng khối đầu tiên. Nhập mật khẩu bằng `read -rs` để không lộ trong lịch sử lệnh:

```bash
read -rs SEED_PASSWORD && export SEED_PASSWORD
SEED_EMAIL=<email-truong-khoi> pnpm seed
unset SEED_PASSWORD
```

Chạy môi trường phát triển:

```bash
pnpm dev
```

Mở http://localhost:3000 và đăng nhập bằng tài khoản vừa tạo.

## Quy trình sử dụng

1. Trưởng khối đăng nhập, vào mục **Khối**.
2. Tạo **lớp**.
3. Tạo **tài khoản GLV** (đặt mật khẩu tạm thời cho họ). Khi GLV quên mật khẩu, trưởng khối vào trang **Khối**, mục **Đặt lại mật khẩu**, chọn GLV rồi nhập mật khẩu tạm mới (10–72 ký tự) và gửi cho họ.
4. **Gán GLV vào lớp** (hoặc gán chính mình để điểm danh thay).
5. GLV nhập hoặc nhập CSV danh sách thiếu nhi, tạo sơ đồ chỗ ngồi, rồi điểm danh từng buổi bằng sơ đồ hoặc checklist.

## Điểm danh bằng thẻ QR

### In thẻ và cấp lại mã

Thiếu nhi → **In thẻ QR** (chỉ người có quyền ghi lớp). In A4 (mỗi trang 10 thẻ 90×55 mm) hoặc lưu PDF; nên ép plastic. Mã thẻ lưu trong database nên **in lại được bất cứ lúc nào**. Mất thẻ thì bấm **Cấp lại mã** cho riêng em đó: thẻ cũ lập tức vô hiệu, mã mới không bao giờ được trả về trình duyệt ngoài trang in.

### Quét thẻ

Mở buổi điểm danh → **Quét QR** (màn hình toàn trang, tối ưu thao tác một tay):

- Chọn chế độ **Có mặt** hoặc **Đi muộn** ở thanh dưới; chế độ được nhớ theo từng buổi.
- Quét một em đang được đánh dấu vắng thì app **hỏi xác nhận** (Có mặt / Đi muộn / Giữ nguyên) thay vì tự ghi đè.
- Mỗi lượt quét có nút **Hoàn tác** riêng (hoàn tác đúng lượt đó, không ảnh hưởng thao tác thủ công khác).
- Thẻ hỏng hoặc quên: **tìm theo tên** ngay trong màn quét; vẫn dùng được khi camera bị từ chối.
- Đèn pin, âm thanh/rung có nút bật tắt. App giữ màn hình sáng (**Wake Lock**) khi camera đang chạy, và tự mở lại camera khi mở khóa máy hoặc quay lại tab.
- Cuối buổi, bấm **Kiểm tra cuối buổi** để xem lại: danh sách em chưa điểm danh và các lượt cần xử lý. Nếu còn em chưa được đánh dấu, nút **Đánh vắng N em còn lại** ghi "vắng không phép" cho những em chưa có dòng nào (không đụng tới em đã có trạng thái). Nút bị khóa khi còn lượt quét chưa gửi xong. Sai thì sửa từng em (ví dụ đổi sang "có phép"). Nút này cũng có trên bảng điểm danh; ở đó nó cũng bị khóa khi **máy này** còn lượt quét chưa gửi của buổi (bảng hiện "N lượt quét chưa gửi — mở màn quét để gửi").
- **Xong** về bảng điểm danh (hỏi lại nếu còn lượt chưa lưu). Mở máy quét từ nút "Quét QR" của bảng thì Xong **lùi lại** đúng mục bảng cũ (Back tiếp theo về trang trước bảng); mở từ trang chủ hoặc gõ URL thì Xong thay mục máy quét bằng bảng (Back không quay lại máy quét).
- **Buổi nghỉ lễ**: máy quét báo "Buổi này nghỉ lễ — không điểm danh", không mở camera, và từ chối mọi lượt quét/chọn tên (máy chủ cũng từ chối). Tắt "Buổi nghỉ lễ" trên bảng nếu buổi đó vẫn học.

### Hàng chờ gửi bền vững (chịu mất mạng ngắn)

Mỗi lượt quét được lưu ngay vào `localStorage` **của thiết bị đó** (khóa theo tài khoản + buổi) trước khi gửi:

- Lượt chưa gửi được (mất mạng, máy chủ lỗi, hết phiên) **còn nguyên khi tải lại trang hay đóng mở lại app**, và được gửi lại khi có mạng, khi tab hiện lại hoặc khi bấm "Thử gửi lại". Mỗi lượt có mã sự kiện riêng nên gửi lại không tạo bản ghi trùng.
- Hàng chờ tối đa 50 lượt, giữ tối đa **3 ngày** rồi bị xóa. Mã thẻ có nằm trong hàng chờ trên thiết bị (đây là lý do mã thẻ chỉ nên coi là bí mật nhẹ).
- Hàng chờ được xóa khi **xác nhận đăng xuất** (nếu còn lượt chưa gửi, màn Tài khoản cảnh báo trước khi đăng xuất).
- Hết phiên đăng nhập giữa chừng: màn quét báo "Cần đăng nhập lại", giữ hàng chờ; đăng nhập lại (app đưa về đúng màn quét) thì hàng chờ được gửi tiếp.
- Hai tab cùng buổi trên một máy dùng chung một hàng chờ và được hợp nhất khi ghi.

**Quan trọng:** điểm danh **chưa được ghi trên máy chủ cho tới khi thiết bị có mạng và lượt quét gửi thành công**. Đây không phải chế độ ngoại tuyến thật: máy hỏng, xóa dữ liệu trình duyệt hoặc quá 3 ngày thì lượt chưa gửi mất. Màn quét hiển thị rõ "Đang gửi / Chưa gửi được"; rời trang khi còn lượt chưa gửi sẽ có hộp thoại cảnh báo (nút Quay lại cũng được chặn). Các thao tác chạm trên **bảng điểm danh** (không phải quét) **cần kết nối ngay lúc bấm**: không có hàng chờ ở đó.

### Bảng điểm danh: trạng thái lưu

Mỗi lần chạm cập nhật tức thì rồi lưu nền. Chip cạnh bộ đếm cho biết **Đang lưu N… / Đã lưu ✓**. Lưu hỏng hoặc quá 10 giây thì em đó được **trả về trạng thái cũ** và hiện thông báo kèm **Thử lại**. "Tất cả có mặt" có thanh **Hoàn tác** trong vài giây. Mất mạng có banner cảnh báo. Rời trang khi còn thao tác chưa lưu xong sẽ có hộp thoại "Chưa lưu xong".

### Camera: HTTPS và cấp quyền

Camera chỉ hoạt động trên **HTTPS** (Vercel có sẵn; chạy máy cá nhân dùng `http://localhost`). Nếu bị chặn:

- **iPhone (Safari)**: Cài đặt → Safari → Camera → Hỏi/Cho phép; hoặc bấm biểu tượng "aA" trên thanh địa chỉ → Cài đặt trang web → Camera → Cho phép. Với app thêm vào Màn hình chính, cấp quyền trong Cài đặt → tên app.
- **Android (Chrome)**: bấm biểu tượng ổ khóa cạnh địa chỉ → Quyền → Camera → Cho phép; hoặc Cài đặt → Cài đặt trang web → Camera.
- Đóng các app đang dùng camera (gọi video, ghi hình) rồi bấm **Mở lại camera**.

Thẻ nên quét ở khoảng cách tay, tránh bóng loáng của lớp ép plastic; thiếu sáng thì bật đèn pin.

### Vận hành và giới hạn

- Đặt **app và database cùng vùng** (region). Mỗi lượt quét tốn khoảng 7 vòng truy vấn, nên độ trễ mạng giữa app và database nhân lên trực tiếp. Số đo cục bộ ở `docs/superpowers/qr-baseline.md`; số đo trên hạ tầng thật chưa có.
- **Giới hạn tốc độ**: quét/hoàn tác 180 lượt/phút/tài khoản, tải bảng tra lớp 30 lượt/phút/tài khoản. Bộ đếm nằm **trong bộ nhớ của từng instance** (không dùng chung giữa các instance serverless), nên giới hạn thực tế có thể cao hơn khi có nhiều instance. Khi vượt, API trả 429 và máy khách tự gửi lại.
- **Phiên đăng nhập**: trượt 30 ngày (cấp lại cookie khi còn dưới 3 ngày), **trần tuyệt đối 90 ngày** kể từ lúc đăng nhập. **Đặt lại mật khẩu không thu hồi phiên đang có** (giới hạn đã biết: cookie cũ vẫn dùng được tới khi hết hạn; tài khoản bị xóa thì bị chặn ngay vì user được đọc lại từ DB ở mỗi request). Thiếu hoặc ngắn `AUTH_SECRET` (< 32 ký tự) khiến mọi trang trừ `/login` trả lỗi 500.
- Hết phiên khi đang thao tác thì được đưa về `/login?next=<trang hiện tại>` và quay lại đúng trang sau khi đăng nhập; `next` chỉ nhận đường dẫn nội bộ an toàn.

### Xác thực: mọi server action tự kiểm

Proxy (`src/proxy.ts`) **không còn chặn request không phải GET khi thiếu phiên** (để server action tự chuyển hướng đúng giao thức), và `/api/*` nằm ngoài proxy. Vì vậy **mọi server action và mọi route handler phải tự xác thực** bằng `requireUser()` hoặc `getCurrentUser()` (trực tiếp hoặc qua hàm trợ giúp cùng tệp; route quét đi qua `handleScanApi`). Test cấu trúc `src/test/auth-guard.test.ts` quét toàn bộ `src` và **làm test đỏ** nếu một tệp `"use server"` có action không gọi hai hàm đó, hoặc một `route.ts` không tham chiếu `getCurrentUser`/`handleScanApi`. Danh sách miễn trừ rất nhỏ và có lý do ngay trong test: `login` (chưa có phiên) và `logout` nội tuyến ở `/tai-khoan` (trang đã gọi `requireUser`). Bộ kiểm tra dựa trên văn bản (`src/test/auth-guard-check.ts`, có test riêng); khi thêm action theo dạng lạ (ví dụ bọc bằng hàm khác), test sẽ báo "không nhận dạng được": hãy viết lại theo dạng thường (`export async function` + `await requireUser()`).

### Bảo mật

- **Mã thẻ QR là bí mật nhẹ**: chỉ có tác dụng khi người quét đã đăng nhập và có quyền ghi đúng lớp. Không chia sẻ ảnh chụp thẻ. Mã chỉ được đọc ở `db/queries/qr-cards.ts` và `db/queries/scan.ts` (cùng `services/qr-cards.ts`, `services/scan.ts` để so khớp/cấp lại); các truy vấn thiếu nhi khác cố ý không chọn cột này.
- **`X-Forwarded-Host` chỉ đáng tin sau reverse proxy ghi đè header đó** (Vercel làm vậy). Kiểm tra Origin của API quét dựa vào header này: nếu tự host mà đặt app trực tiếp ra internet, hãy có proxy chuẩn hóa/ghi đè `X-Forwarded-Host`.
- **`NEXT_PUBLIC_E2E_SCAN_BRIDGE` chỉ dùng cho E2E** (cầu nối `window.__scanFeed` đưa mã giả lập vào mà không cần camera; chỉ `playwright.config.ts` đặt biến này, E2E chạy bằng `next dev`). Cầu nối chỉ bật khi biến bằng `1` **và** `NODE_ENV` không phải `production`; điều kiện này bị loại lúc biên dịch nên **bản `next build` không còn chứa mã cầu nối** (kể cả khi lỡ đặt biến; kiểm bằng `grep -r __scanFeed .next/static` sau khi build: không có kết quả). Dù vậy, đừng đặt biến này trên production.
- **Header bảo mật** (`next.config.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (chỉ trang của app được xin camera), và HSTS ở production. Chưa có CSP.

## Kiểm thử

```bash
pnpm test        # unit + tích hợp (PGlite, không cần Postgres thật)
pnpm test:cov    # kèm coverage, ép ngưỡng: lines/functions/statements 80%, branches 70%
pnpm test:pg     # test đua (race) trên Postgres thật, cần E2E_DATABASE_URL (xem dưới)
pnpm test:e2e    # Playwright, cần database E2E riêng (xem bên dưới)
pnpm bench:scan  # đo độ trễ POST /api/diem-danh/quet (xem "Đo độ trễ")
```

`pnpm test` gồm cả test cấu trúc xác thực `src/test/auth-guard.test.ts` (xem mục "Xác thực: mọi server action tự kiểm").

### Database cho E2E

Cảnh báo: `e2e/global-setup.ts` chạy `drop schema public cascade` trên database được trỏ tới. Vì vậy chỉ dùng một database dùng một lần, và tên database bắt buộc chứa `e2e` (tệp setup từ chối chạy nếu không).

```bash
E2E_PW=$(openssl rand -hex 12)
docker run -d --name diemdanh-e2e -e POSTGRES_PASSWORD="$E2E_PW" -e POSTGRES_DB=diemdanh_e2e \
  -p 127.0.0.1:55432:5432 postgres:16
export E2E_DATABASE_URL=postgres://postgres:$E2E_PW@127.0.0.1:55432/diemdanh_e2e
pnpm test:e2e
docker rm -f diemdanh-e2e   # dọn dẹp khi xong
```

E2E chạy hai viewport: điện thoại 375px và máy tính bảng 768px.

`pnpm test:pg` dùng cùng máy chủ Postgres đó nhưng tự tạo database riêng `<tên db E2E>_conc` (xóa và migrate lại mỗi lần chạy; tên bắt buộc chứa `e2e`). Thiếu `E2E_DATABASE_URL` thì bộ test được bỏ qua. Không bao giờ trỏ `E2E_DATABASE_URL` vào database thật, và không dán chuỗi kết nối thật vào tài liệu, log hay commit.

### Đo độ trễ

`pnpm bench:scan` gửi 30 lượt quét tuần tự và 30 lượt song song 5 luồng. Giới hạn tốc độ quét là 180 lượt/phút/tài khoản, nên chạy liền nhiều lần sẽ gặp HTTP 429: đợi hết cửa sổ một phút rồi chạy lại. Phương pháp và số đo cục bộ nằm ở `docs/superpowers/qr-baseline.md`; số đo trên hạ tầng thật (cùng vùng với database) là việc của chủ dự án.

## Biểu tượng PWA

`public/icon-192.png`, `public/icon-512.png` và `public/icon-maskable-512.png` (biểu tượng có vùng đệm cho Android) được sinh bằng `node --import tsx scripts/make-icons.ts` (cần Playwright Chromium: `pnpm exec playwright install chromium`). Manifest nằm ở `src/app/manifest.ts`.

## Triển khai lên Vercel

1. Đặt `DATABASE_URL` và `AUTH_SECRET` trong Project Settings, mục Environment Variables, cho cả môi trường Production và Preview. `DATABASE_URL` chỉ cần lúc chạy: `src/db/client.ts` kết nối lười ở lần truy vấn đầu tiên nên `next build` không cần biến này (thiếu biến thì lần truy vấn đầu báo lỗi rõ ràng).
2. Trước mỗi lần deploy có migration mới, chạy `pnpm db:migrate` với `DATABASE_URL` trỏ tới database production.
3. Không commit `.env*` vào git.

## Giới hạn đã biết

- **Phiên đăng nhập không thu hồi được từ máy chủ.** Đăng xuất hoặc đặt lại mật khẩu không vô hiệu hóa cookie đã cấp: cookie vẫn dùng được tới khi hết hạn (trượt 30 ngày, trần tuyệt đối 90 ngày). Cần thêm phiên bản phiên theo từng người dùng (session version) để khắc phục.
- **Không có chế độ ngoại tuyến thật.** Hàng chờ quét chỉ giữ lượt chưa gửi trên thiết bị tối đa 3 ngày; điểm danh chỉ được ghi khi thiết bị có mạng. Thao tác trên bảng điểm danh cần kết nối ngay lúc bấm.
- **Chưa có nhắc muộn tự động** theo giờ bắt đầu lớp.
- **Giới hạn tốc độ nằm trong bộ nhớ từng instance**, chưa có bộ đếm dùng chung/phân tán.
- **Khóa đăng nhập theo email**, không giới hạn theo IP. Tài khoản bị khóa tạm khi sai quá 5 lần; vẫn thử tiếp thì thời gian khóa kéo dài. Kẻ tấn công biết email của một GLV có thể khóa tài khoản đó.
- **Cần Node >= 22.9** do dùng `Map.groupBy` và cờ `--env-file-if-exists`.
- Nút tùy chọn trên ô chỗ ngồi là một điều khiển phụ, khá nhỏ.
- **Đảm bảo đồng thời** (advisory lock, `FOR UPDATE`, so sánh-và-ghi) được kiểm thử bằng `pnpm test:pg` trên Postgres thật nhiều kết nối, nhưng chưa thử tải nhiều tiến trình/instance thật.
- Chưa thử trên điện thoại thật (Android/iPhone) và chưa đo độ trễ trên hạ tầng thật: xem `docs/superpowers/qr-release-checklist.md`.
