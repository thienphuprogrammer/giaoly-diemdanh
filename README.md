# Điểm danh Giáo lý

Ứng dụng web (PWA) để giáo lý viên (GLV) điểm danh lớp giáo lý theo sơ đồ chỗ ngồi hoặc thẻ QR, điểm danh đi lễ, hồ sơ từng em, thống kê và báo cáo học kỳ (in A4 / PDF / Excel), danh sách cần chú ý, nhật ký thay đổi, năm học mới và lên lớp, thông báo đẩy và nhắc việc tự động. Admin quản lý tài khoản, khối và lớp theo năm học. Giao diện bằng tiếng Việt, hỗ trợ điện thoại, tablet, laptop và PC.

Mục lục nhanh: [Cài đặt](#cài-đặt-và-chạy) · [Triển khai](#triển-khai) · [Quản trị toàn hệ thống](#quản-trị-toàn-hệ-thống) · [Quy trình sử dụng](#quy-trình-sử-dụng) · [Hồ sơ em](#hồ-sơ-em) · [Điểm danh đi lễ](#điểm-danh-đi-lễ) · [Nhật ký thay đổi](#nhật-ký-thay-đổi) · [Năm học mới và lên lớp](#năm-học-mới-và-lên-lớp) · [Báo cáo học kỳ](#báo-cáo-học-kỳ) · [Thẻ QR](#điểm-danh-bằng-thẻ-qr) · [Thông báo đẩy và nhắc việc](#thông-báo-đẩy-web-push-và-lịch-học) · [iPhone](#dùng-trên-iphone) · [Kiểm thử](#kiểm-thử) · [Giới hạn đã biết](#giới-hạn-đã-biết)

Công nghệ: Next.js 16 (App Router), React 19, Postgres (Drizzle ORM), Tailwind CSS 4, Vitest, Playwright.

## Yêu cầu

- Node.js >= 22.9 (mã dùng `Map.groupBy`; script `seed` và `db:migrate` dùng `--env-file-if-exists`)
- pnpm 10
- Một database Postgres 16 (Neon, Supabase hoặc tự dựng); **tối thiểu PostgreSQL 15** (bảng `notification_log` dùng `UNIQUE NULLS NOT DISTINCT`; `pnpm preflight` báo LỖI nếu máy chủ cũ hơn)

## Biến môi trường

Sao chép `.env.example` thành `.env.local` rồi điền giá trị (các biến tuỳ chọn có sẵn ở dạng chú thích, kèm lệnh sinh). Không commit `.env.local` hay tệp `.env*` nào chứa giá trị thật.

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | Chuỗi kết nối Postgres |
| `AUTH_SECRET` | Khóa ký phiên đăng nhập, tối thiểu 32 ký tự. Sinh bằng `openssl rand -base64 32` |
| `DATABASE_URL_UNPOOLED` | Tùy chọn. Chuỗi kết nối trực tiếp/session (không qua pooler giao dịch), `pnpm db:migrate` ưu tiên dùng nó nếu có |
| `DB_POOL_MAX` | Tùy chọn. Số kết nối tối đa mỗi instance, 1–20, mặc định 5 (giảm xuống ở DB gói miễn phí nếu thiếu kết nối) |
| `DB_PREPARE` | Tùy chọn. Đặt `false` khi `DATABASE_URL` đi qua pooler chế độ giao dịch (pgbouncer, cổng 6543); mặc định bật |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Tùy chọn (thông báo đẩy). Sinh cặp khoá bằng `pnpm push:keys` (chỉ in ra màn hình, không ghi tệp); `VAPID_SUBJECT` là `mailto:email-liên-hệ` hoặc `https://tên-miền`. **`VAPID_PRIVATE_KEY` là bí mật: không commit.** Thiếu cả ba = thông báo đẩy tắt (nút ở Tài khoản hiện "Chưa sẵn sàng"); đặt thiếu/sai = `pnpm preflight` cảnh báo. Khoá công khai được trang đọc lúc chạy (không phải `NEXT_PUBLIC_*`), đổi khoá không cần build lại nhưng mọi thiết bị phải đăng ký lại (tự làm khi mở trang Tài khoản). |
| `CRON_SECRET` | Tùy chọn (nhắc việc tự động **và dọn nhật ký 365 ngày**). Bí mật ≥ 32 ký tự cho route `/api/cron/nhac-viec`, sinh bằng `openssl rand -base64 48`. **Bí mật: không commit.** Khoảng trắng/xuống dòng đầu cuối được cắt bỏ. Thiếu hoặc ngắn hơn 32 ký tự thì route trả 503 và không bao giờ chạy (không nhắc, không dọn nhật ký); `pnpm preflight --prod` cảnh báo. Cách kích hoạt định kỳ: `docs/deploy-vercel-ios.md`, mục 9 "Nhắc việc tự động". |
| `PUSH_DRY_RUN` | **Chỉ E2E.** `1` = không gửi thông báo đẩy ra mạng (coi như thành công), chỉ có hiệu lực khi `NODE_ENV` là `test`/`development`; bản production luôn bỏ qua. Không đặt trên Vercel (`pnpm preflight --prod` báo LỖI). |
| `CSP_ALLOW_UNSAFE_EVAL` | Tùy chọn, mặc định tắt. Đặt `1` lúc build nếu cần hỗ trợ iPhone iOS 15 trở xuống (máy quét QR cần WebAssembly), đổi lại CSP yếu hơn (cho phép `'unsafe-eval'`). Mặc định máy quét cần iOS 16+. Xem `docs/ios-checklist.md`. |

Các biến chỉ dùng cho `pnpm seed`: `SEED_EMAIL`, `SEED_PASSWORD` (tối thiểu 10 ký tự), và tùy chọn `SEED_NAME`, `SEED_GRADE`, `SEED_YEAR`, `SEED_T1_START`, `SEED_T1_END`, `SEED_T2_START`, `SEED_T2_END`.

Các biến chỉ dùng cho `pnpm admin:create`: `ADMIN_EMAIL`, `ADMIN_NAME` và tùy chọn `ADMIN_PASSWORD`. Tài khoản mới sẽ yêu cầu nhập mật khẩu ẩn hai lần trên terminal nếu chưa đặt `ADMIN_PASSWORD`; tài khoản đã tồn tại giữ mật khẩu hiện có khi bỏ qua biến này. Mật khẩu cần ít nhất 10 ký tự và tối đa 72 byte UTF-8. Chỉ cấp `ADMIN_PASSWORD` qua môi trường bảo mật khi chạy không tương tác; không ghi giá trị vào mã nguồn, tài liệu hay lịch sử lệnh.

## Cài đặt và chạy

```bash
pnpm install
pnpm db:migrate      # áp dụng migration vào DATABASE_URL (đọc .env.local)
```

Tạo admin đầu tiên sau khi migration hoàn tất:

```bash
read -r -p "Email admin: " ADMIN_EMAIL
read -r -p "Tên admin: " ADMIN_NAME
export ADMIN_EMAIL ADMIN_NAME
pnpm admin:create
unset ADMIN_EMAIL ADMIN_NAME
```

Công cụ yêu cầu nhập và xác nhận mật khẩu ẩn khi tạo tài khoản mới. Email được so khớp không phân biệt chữ hoa/thường. Nếu email đã thuộc một tài khoản không phải admin, công cụ từ chối trừ khi chạy `pnpm admin:create --promote-existing`; khi đó tài khoản được nâng thành admin đang hoạt động, giữ mật khẩu khi không có `ADMIN_PASSWORD`. Chạy lại cho một admin đã có thì không cần cờ này. Đổi quyền hoặc mật khẩu sẽ thu hồi phiên cũ. Sau khi đăng nhập, vào **Quản trị** để tạo khối, năm học, lớp và tài khoản khối trưởng/GLV.

Tùy chọn: `pnpm seed` tạo tài khoản trưởng khối và dữ liệu khởi đầu. Nhập mật khẩu bằng `read -rs` để không lộ trong lịch sử lệnh:

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

## Triển khai

Triển khai lên Vercel (vùng Singapore `sin1`) với Postgres hosted cùng vùng, rồi dùng trên iPhone: xem [`docs/deploy-vercel-ios.md`](docs/deploy-vercel-ios.md) (hướng dẫn từng bước, gồm biến môi trường, migration, sao lưu/quay lui và nhắc việc). Có sẵn `vercel.json`, route kiểm tra sống `GET /api/health` (công khai, chỉ trả `ok`/`db`/`version`) và `pnpm preflight [--prod]` (kiểm biến môi trường, kết nối DB, phiên bản PostgreSQL ≥ 15, múi giờ và migration đã đủ chưa).

- `DATABASE_URL` chỉ cần lúc chạy (`src/db/client.ts` kết nối lười), `next build` không cần.
- **Migration không tự chạy khi build**: sao lưu database rồi chạy `pnpm db:migrate` từ máy bạn trước khi deploy bản có migration mới. Migration chỉ đi tới (không có lệnh lùi).
- **Chuyển sang lớp theo năm học**: migration `0011_admin_annual_classes.sql` giữ ID lớp và lịch sử hiện có. Nếu một lớp cũ có buổi thuộc nhiều năm học, migration chủ động dừng trước khi đổi dữ liệu; cần chuẩn bị ánh xạ tách lớp riêng cho trường hợp đó. Xem [quyết định kiến trúc](docs/architecture/2026-10-13-admin-annual-classes.md).
- Danh sách kiểm phát hành Mốc 9 (kết quả chạy thật + việc của chủ dự án): [`docs/superpowers/release-checklist-moc9.md`](docs/superpowers/release-checklist-moc9.md).

### Kiểm tra CSP trên bản production (bước tay)

E2E chạy bằng `next dev`, nơi CSP cho phép `'unsafe-eval'`; CSP thật của bản build **không** được E2E kiểm. Sau mỗi lần đổi `next.config.ts`, `src/lib/security-headers.ts`, thư viện QR hoặc thêm script bên thứ ba, hãy tự kiểm một lần:

1. `pnpm build && pnpm start` (hoặc mở bản Preview trên Vercel).
2. Mở DevTools → Console, đi qua: `/login`, trang chủ, một bảng điểm danh (chạm một em), màn **Quét QR** (camera chạy, quét một thẻ), trang Tài khoản (bấm "Bật thông báo"), một báo cáo in được.
3. Không được có dòng "Refused to … because it violates the following Content Security Policy directive". Tab Network → tài liệu HTML phải có header `Content-Security-Policy` không chứa `'unsafe-eval'` (trừ khi build với `CSP_ALLOW_UNSAFE_EVAL=1`).

## Quản trị toàn hệ thống

Admin vào **Quản trị** (`/quan-tri`):

- **Tài khoản**: tạo, sửa tên/email, đặt vai trò **Admin / Khối trưởng / Giáo lý viên**, chọn khối cho khối trưởng, khóa/mở lại và đặt lại mật khẩu. Tài khoản được khóa vẫn giữ phân công và lịch sử; mở lại yêu cầu đăng nhập mới. Không tự khóa/hạ quyền và không được bỏ admin đang hoạt động cuối cùng.
- **Khối**: tạo, đổi tên, đặt ngưỡng cảnh báo đi lễ và khối kế tiếp; mở báo cáo khối theo năm.
- **Lớp**: chọn năm học và khối khi tạo, phân công/gỡ phân công tài khoản, sửa tên/khối. Lớp cùng tên được dùng lại ở năm khác; mỗi năm có lớp, phân công, sơ đồ và buổi điểm danh riêng. Sửa lớp không đổi năm của lớp.
- **Năm học và lên lớp** (`/quan-tri/nam-hoc`): tạo năm với hai học kỳ, đổi tên năm, chuyển thiếu nhi sang lớp đã tạo ở cùng năm hoặc năm sau, xem và hoàn tác lượt chuyển đủ điều kiện.
- **Xóa dữ liệu**: chỉ xóa khối/lớp/năm chưa được sử dụng. Dữ liệu có tài khoản, phân công, thiếu nhi, lớp hoặc lịch sử liên quan sẽ được giữ lại; quản lý tài khoản bằng khóa/mở lại.

Trang chủ, danh sách lớp, trang Khối và báo cáo có bộ chọn năm học. Khối và tài khoản dùng chung xuyên năm; muốn mở năm mới thì tạo các lớp của năm đó và phân công lại cho từng lớp.

## Quy trình sử dụng

1. Trưởng khối đăng nhập, vào mục **Khối**.
2. Chọn **năm học**, tạo **lớp** trong năm đó, đặt **lịch học** (thứ + giờ, ở trang lớp, do người có quyền ghi lớp đặt) nếu muốn được nhắc điểm danh.
3. Tạo **tài khoản GLV** (đặt mật khẩu tạm thời cho họ). Khi GLV quên mật khẩu, trưởng khối vào trang **Khối**, mục **Đặt lại mật khẩu**, chọn GLV rồi nhập mật khẩu tạm mới (ít nhất 10 ký tự, tối đa 72 byte UTF-8) và gửi cho họ.
4. **Gán GLV vào lớp** (hoặc gán chính mình để điểm danh thay).
5. GLV nhập hoặc nhập CSV danh sách thiếu nhi, tạo sơ đồ chỗ ngồi, rồi điểm danh từng buổi bằng sơ đồ, checklist hoặc **quét thẻ QR**; ghi **đi lễ** ngay trên bảng hoặc quét tại nhà thờ.
6. Theo dõi **Cần chú ý**, **hồ sơ từng em** và **Thống kê**; cuối học kỳ in **báo cáo học kỳ**.
7. Cuối năm, trưởng khối vào **Khối → Năm học mới và lên lớp** (mục [Năm học mới và lên lớp](#năm-học-mới-và-lên-lớp)).

Quyền: admin **đọc/ghi** mọi lớp và quản lý toàn hệ thống; GLV được phân công lớp thì **ghi** lớp đó; trưởng khối **đọc** mọi lớp của khối mình (ghi khi tự gán vào lớp). Người không có quyền mở đường dẫn của lớp sẽ thấy 404. Hồ sơ em đã chuyển khỏi lớp cũ vẫn xem được từ lớp cũ nhưng không sửa qua lớp đó.

## Hồ sơ em

Bấm tên em ở danh sách thiếu nhi, "Cần chú ý" hoặc thống kê để mở `/lop/<lớp>/thieu-nhi/<em>`:

- Chuyên cần học kỳ (có mặt, muộn, vắng có/không phép, % chuyên cần), lịch sử từng buổi học (mới nhất trước; buổi huỷ không tính) và khối **Đi lễ** (tuần đã tính, đi lễ / vắng lễ từng tuần, cảnh báo theo ngưỡng của khối). Lịch sử theo em nên vẫn thấy các buổi ở lớp cũ sau khi lên lớp.
- Nút liên hệ phụ huynh: **Gọi**, **Nhắn Zalo** (mở `zalo.me`), **SMS**; không có số thì hiện "Chưa có số phụ huynh". "Cần chú ý" có thêm nút **Gọi phụ huynh** cạnh từng em. Số điện thoại chỉ dùng để dựng liên kết trên máy chủ, không đưa vào props của các thành phần chạy ở trình duyệt trong danh sách.
- Người có quyền ghi lớp sửa nhanh số phụ huynh và ghi chú ngay trên hồ sơ của em đang ở lớp; em đã chuyển sang lớp khác chỉ xem tại lớp cũ.
- **Kiểm số điện thoại chặt** (Việt Nam, 10–11 chữ số, chấp nhận `+84`/`84`/`0084`, dấu cách/chấm/gạch được bỏ khi lưu) ở **mọi** đường lưu: thêm, sửa, sửa nhanh, nhập CSV. Hệ quả cần biết:
  - Em có số **dạng cũ không hợp lệ** (lưu từ trước khi kiểm chặt) vẫn hiện số thô nhưng **không có nút liên hệ**, và **không lưu được bất kỳ sửa đổi nào của em đó cho tới khi sửa lại số** (hoặc xoá số).
  - Nhập CSV **bỏ qua các dòng có số không hợp lệ** (báo số dòng bị bỏ), các dòng khác vẫn được nhập.

## Điểm danh đi lễ

Đi lễ Chúa nhật được ghi **riêng** với buổi học (một "buổi đi lễ" mỗi tuần cho mỗi lớp, `sessions.kind = 'mass'`), có hai cách, dùng cách nào cũng được, kết quả là một:

1. **Tích nhanh trong buổi học**: trên bảng điểm danh, mở mục **Đi lễ** (gập sẵn, hiện "Đi lễ: N/M em · Chúa nhật dd/mm/yyyy"). Mỗi em có bốn lựa chọn: **Chưa hỏi / Có đi / Có phép / Không phép**; nút **Cả lớp đi lễ** ghi "có đi" cho các em chưa hỏi (có Hoàn tác vài giây). Tuần đi lễ là **Chúa nhật gần nhất trên hoặc trước ngày học** (học Chúa nhật → chính ngày đó; học thứ Bảy → Chúa nhật hôm trước). Đi lễ không có "đi muộn".
2. **Quét thẻ tại nhà thờ**: trang lớp → **Điểm danh đi lễ** (Chúa nhật tuần này), hoặc từ mục Đi lễ của bảng → **Quét tại nhà thờ**. Máy quét như buổi học nhưng mỗi lượt quét = "Đi lễ"; em đang ghi vắng thì hỏi xác nhận. Cuối buổi chỉ xem danh sách "Em chưa ghi nhận đi lễ", **không có nút đánh vắng** (chưa ghi nhận không tính là vắng). Ngày khác Chúa nhật (lễ trọng) phải chọn thủ công.

**Huỷ / mở lại một tuần**: "Tuần này không có lễ" (trên mục Đi lễ của bảng hoặc trên đầu máy quét) đánh dấu tuần đó không tính; "Mở lại tuần đi lễ" bỏ đánh dấu. Huỷ đi lễ và "Buổi nghỉ lễ" của buổi học độc lập với nhau.

**Cách tính "vắng lễ"** (một định nghĩa dùng chung cho hồ sơ, thống kê đi lễ, Cần chú ý, báo cáo và thông báo):

- Một **tuần đã ghi nhận** = buổi đi lễ của lớp trong học kỳ, **không bị huỷ** và **có ít nhất một dòng** (của bất kỳ em nào). Tuần chưa mở, mở mà trống, hoặc đã huỷ thì không tính.
- Em **vắng lễ** một tuần đã ghi nhận khi em **không có dòng "có đi"** trong tuần đó (vắng có phép, không phép hay chưa hỏi đều là vắng lễ).
- **Em vào lớp giữa chừng** (không có cột ngày nhập học): chỉ tính các tuần **từ ngày của dòng điểm danh đầu tiên của em ở lớp hiện tại** (buổi học hoặc đi lễ, mọi học kỳ). Sau khi lên lớp, việc đếm bắt đầu lại ở lớp mới.
- **Cảnh báo vắng lễ** khi số tuần vắng lễ ≥ **ngưỡng của khối** (mặc định **2**, trưởng khối sửa ở trang Khối, 1–20).

**Hạn chế cần biết**: em **chưa từng được ghi dòng nào** (không có dòng điểm danh nào ở lớp hiện tại, kể cả buổi học) thì **không bao giờ bị cảnh báo vắng lễ**. Để tránh bỏ sót, cuối mỗi buổi học hãy bấm **Đánh vắng các em còn lại** (bảng điểm danh hoặc "Kiểm tra cuối buổi" của máy quét) để mọi em đều có ít nhất một dòng.

## Nhật ký thay đổi

Tab **Nhật ký** của mỗi lớp (`/lop/<lớp>/nhat-ky`) cho **mọi người đọc được lớp** (admin, GLV của lớp, trưởng khối của khối) xem dòng thời gian: ai, lúc nào, đổi gì; lọc theo ngày và loại (Điểm danh, Đi lễ, Thiếu nhi, Sơ đồ, Buổi học, Quét thẻ), phân trang "Xem thêm".

- **Có ghi** (cùng giao dịch với thay đổi, chỉ khi thật sự có thay đổi): đổi trạng thái điểm danh/đi lễ (trước → sau), "Tất cả có mặt"/"Cả lớp đi lễ" và hoàn tác, "Đánh vắng các em còn lại", huỷ/mở lại buổi học hoặc tuần đi lễ, thêm/sửa/nghỉ học/đi học lại/nhập CSV/sửa liên hệ/cấp lại mã thẻ của em, tạo/áp mẫu/lưu bố cục/kích hoạt/xoá sơ đồ, đổi lịch học, lượt lên lớp và hoàn tác (ở **cả lớp cũ và lớp mới**).
- **Lượt quét thẻ** nằm trong nhật ký quét riêng (`attendance_scans`) và được **gộp vào cùng dòng thời gian** (lọc "Quét thẻ").
- **Quản trị cũng được ghi**: tạo/sửa/khóa/mở lại tài khoản, đặt lại mật khẩu, gán/gỡ lớp, tạo/sửa/xóa lớp và khối, tạo/đổi tên/xóa năm học. Nhật ký lớp chỉ hiện sự kiện thuộc lớp; sự kiện cấp khối/toàn hệ thống được lưu nhưng **chưa có trang xem riêng**.
- **Không ghi**: xếp một em vào ghế (`assignSeat`) và mở buổi điểm danh.
- Không bao giờ ghi mã thẻ hay mật khẩu; số điện thoại chỉ lưu dạng che (`••••••567`); ghi chú tự do không được ghi.
- **Lưu giữ 365 ngày**: dòng cũ hơn được xoá bởi phần dọn dẹp hằng ngày của tác vụ nhắc việc (`/api/cron/nhac-viec`). **Không đặt `CRON_SECRET` (hoặc không có gì gọi route) thì không có dọn dẹp**: nhật ký tăng mãi. Nhật ký quét `attendance_scans` **không bao giờ được dọn** (kể cả khi cron chạy).

## Năm học mới và lên lớp

Trưởng khối vào **Khối → Năm học mới và lên lớp** (`/khoi/nam-hoc`); admin vào **Quản trị → Năm học và lên lớp** (`/quan-tri/nam-hoc`).

**Năm học**

- Năm học (gồm hai học kỳ) **dùng chung cho mọi khối**. App gợi ý tên và ngày từ năm trước (+1 năm). Kiểm tra: tên không trùng (không phân biệt hoa thường), học kỳ 1 kết thúc trước học kỳ 2, cả năm tối đa 400 ngày, không chồng lên học kỳ nào đã có. Trưởng khối chỉ tạo năm bắt đầu sau năm gần nhất và trong khoảng 400 ngày trước đến 550 ngày sau hôm nay; admin có thể chuẩn bị các năm xa hơn, vẫn phải thỏa quy tắc ngày và không chồng học kỳ.
- Mỗi **lớp thuộc đúng một năm học**. Tạo năm không tự sao chép lớp; tạo lớp của năm mới trước khi phân công hoặc lên lớp. Admin có thể đổi tên năm mà không đổi dữ liệu lớp/học kỳ.
- Tạo nhầm thì **xóa được khi năm đó chưa có lớp hoặc buổi điểm danh nào**. Có ghi nhật ký.
- Giữa hai năm học (hè), các trang thống kê mặc định hiện **học kỳ gần nhất đã bắt đầu**; năm học tạo sẵn cho tương lai không thành "hiện tại".

**Lên lớp** (chuyển em sang lớp khác):

- Chọn lớp nguồn và lớp đích, có tên năm học để phân biệt các lớp cùng tên. Trưởng khối chọn lớp đích cùng khối hoặc thuộc **khối kế tiếp**; admin chọn được lớp ở mọi khối. Lớp đích phải cùng năm hoặc thuộc năm bắt đầu sau năm nguồn; không chuyển ngược về năm cũ. Tích các em (mặc định tất cả em đang học; em đã nghỉ ở lại lớp cũ), xác nhận. Tối đa 200 em mỗi lượt; bấm hai lần không chuyển hai lần.
- Đây là **chuyển** (đổi lớp hiện tại của em), không phải sao chép: em giữ nguyên **thẻ QR**, hồ sơ và lịch sử. **Chỗ ngồi ở mọi sơ đồ của lớp cũ bị xoá** (danh sách được lưu để tham khảo) và **không được khôi phục khi hoàn tác**.
- **Hoàn tác trong 24 giờ** (admin hoặc trưởng khối của khối nguồn): chỉ đưa về các em **còn ở lớp đích**; em đã bị chuyển tiếp lần nữa thì phải hoàn tác lượt mới hơn trước. Sau 24 giờ, quy tắc không chuyển ngược năm vẫn áp dụng cho lượt chuyển mới.
- Điểm danh cũ (kể cả hôm nay nếu chuyển giữa buổi) ở lại lớp cũ và không sửa được cho các em đã chuyển. Danh sách thành viên lớp cũ vẫn giữ em đã chuyển, kể cả em chưa từng được điểm danh; xem hồ sơ cũ ở chế độ chỉ đọc.

**Thống kê học kỳ sau khi lên lớp**

- **Học kỳ hiện tại**: tính theo lớp hiện tại (lớp cũ không còn em đã chuyển; lớp mới có em, chưa có dòng nào).
- **Học kỳ đã qua** giữ các em có điểm danh ở lớp trong học kỳ, các em đang học chưa có điểm danh ở lớp khác trong học kỳ, và thành viên đã chuyển đi chưa có điểm danh nào trong học kỳ. Nhãn cho biết em đã chuyển hoặc đã nghỉ. Khi đã có điểm danh, lớp/học kỳ của buổi là căn cứ cho lịch sử. Quy tắc này dùng chung cho thống kê, thống kê đi lễ, trang Khối, báo cáo in, Excel và tổng hợp khối.
- Danh sách cần hành động (trang chủ, "Cần chú ý", thông báo) **chỉ** gồm em đang học ở lớp.

**Mô hình tin cậy**

- Admin được chuyển em giữa mọi khối. Trưởng khối chỉ chuyển em đang học ở lớp của khối **nguồn** mình quản lý; lớp đích là lớp cùng khối hoặc thuộc **khối kế tiếp** đã chọn. Không có bước đồng ý của khối đích. Đặt khối kế tiếp cần xác nhận hai bước và được ghi nhật ký.
- Bù lại là minh bạch: mỗi lượt chuyển ghi nhật ký ở **cả lớp cũ và lớp mới**; trưởng khối đích thấy lượt "Chuyển vào" (chỉ xem) và một băng báo 7 ngày khi khối khác chuyển em vào hoặc chọn khối mình làm khối kế tiếp. Trưởng khối nguồn **không** đọc thêm được gì của khối đích.

## Báo cáo học kỳ

- **Báo cáo lớp in được**: Thống kê → **Báo cáo in được** (`/lop/<lớp>/thong-ke/bao-cao?termId=…`, cùng quyền đọc lớp). Khổ A4, đầu trang (lớp, khối, học kỳ, ngày tạo, người tạo), bảng từng em: có mặt, muộn, vắng có/không phép, % chuyên cần, đi lễ (đi/đã ghi), cảnh báo; dòng tổng; đầu bảng lặp lại mỗi trang. Bấm **In / Lưu PDF** (chọn "Lưu dưới dạng PDF" trong hộp in của trình duyệt). Không có số điện thoại hay mã thẻ.
- **Excel lớp**: nút Excel ở trang Thống kê (như trước).
- **Tổng hợp khối**: trưởng khối vào Khối → **Báo cáo học kỳ** (`/khoi/bao-cao`); admin chọn khối từ mục Quản trị. Chọn năm và học kỳ để xem các lớp của năm đó: số em, số buổi, % có mặt, số em cảnh báo vắng học/vắng lễ, số tuần đi lễ đã ghi; danh sách "Em đang cảnh báo (đang học ở lớp)" (không có số điện thoại); tải **Excel** (hai sheet "Tổng hợp khối" và "Cảnh báo").
- Học kỳ đã qua dùng quy tắc danh sách ở mục [Năm học mới và lên lớp](#năm-học-mới-và-lên-lớp).

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
- **Phiên đăng nhập**: trượt 30 ngày (cấp lại cookie khi còn dưới 3 ngày), **trần tuyệt đối 90 ngày** kể từ lúc đăng nhập. Máy chủ kiểm tra trạng thái tài khoản và `sessionVersion` ở mỗi request: đổi vai trò/khối, khóa/mở lại hoặc đặt lại mật khẩu thu hồi mọi phiên cũ, kể cả nhiều thay đổi trong cùng một giây. Tự đổi mật khẩu ở **Tài khoản** thu hồi các phiên khác và cấp phiên mới cho thiết bị đang đổi. Thiếu hoặc ngắn `AUTH_SECRET` (< 32 ký tự) khiến mọi trang trừ `/login` trả lỗi 500.
- Hết phiên khi đang thao tác thì được đưa về `/login?next=<trang hiện tại>` và quay lại đúng trang sau khi đăng nhập; `next` chỉ nhận đường dẫn nội bộ an toàn.

### Thông báo đẩy (Web Push) và lịch học

- **Lịch học** của lớp (thứ + giờ bắt đầu, có thể để trống) sửa ở trang lớp, chỉ bởi GLV được phân công (trưởng khối chỉ xem); thứ và giờ phải cùng có hoặc cùng trống (CHECK trong DB); mỗi lần đổi ghi nhật ký `class.schedule`. Dùng cho nhắc việc (mục dưới); trống = không nhắc.
- **Bật thông báo** ở trang Tài khoản: chỉ xin quyền khi bấm. iPhone/iPad cần **Thêm vào Màn hình chính** (iOS 16.4+), app hướng dẫn tại chỗ. Mỗi người tối đa 10 thiết bị: mỗi lần mở trang Tài khoản thiết bị đồng bộ lại và mốc thời gian được đặt lại, nên khi vượt trần thì thiết bị **lâu nhất chưa đồng bộ** bị bỏ. Một thiết bị đổi tài khoản thì đăng ký chuyển sang tài khoản mới. "Tắt thông báo" được nhớ trên thiết bị (theo tài khoản): trang không tự bật lại cho tới khi bấm "Bật thông báo". Đăng xuất gỡ đăng ký của thiết bị đó (cố gắng hết sức, tối đa 2 giây, không chặn đăng xuất). "Gửi thử" chỉ gửi tới thiết bị của chính mình (3 lần/phút).
- **`public/sw.js` chỉ xử lý push và bấm thông báo**: không có fetch handler, không cache dữ liệu điểm danh. Phục vụ với `Cache-Control: no-cache` và không qua proxy đăng nhập.
- **Chống SSRF**: máy chủ chỉ gửi tới endpoint HTTPS của các dịch vụ push đã biết (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`; danh sách là hằng số trong `src/lib/push/endpoint.ts`, không mở rộng qua biến môi trường). Không IP, không localhost, không cổng lạ, không punycode.
- Endpoint được kiểm lại theo danh sách cho phép ngay lúc gửi (dòng không hợp lệ bị xoá, không liên lạc). Gửi trả 404/410 thì xoá đăng ký; 429/5xx/lỗi mạng (mất kết nối, hết giờ) tăng bộ đếm và xoá sau 5 lần liên tiếp; 401/403 (thường do đổi khoá VAPID) đếm riêng và xoá sau 10 lần liên tiếp; lỗi cục bộ (khoá hỏng, lỗi thư viện) và mã khác chỉ ghi log mã, không bao giờ làm xoá đăng ký. Gửi nhiều (`sendMany`): tối đa 5 lượt cùng lúc, mỗi lượt hạn chót 15 giây. Log không bao giờ chứa endpoint hay khoá.

### Nhắc việc tự động (`/api/cron/nhac-viec`)

- Route `GET|POST /api/cron/nhac-viec` chỉ xác thực bằng header `Authorization: Bearer <CRON_SECRET>` (so sánh hằng thời gian; không đọc phiên). Trả `Cache-Control: no-store` và chỉ các số đếm `{sent, skipped, failed, pruned, truncated}`.
- **Route không tự chạy**: cần một bộ gọi định kỳ (~10 phút). Chọn một trong ba (chi tiết: `docs/deploy-vercel-ios.md` mục 9):
  - **GitHub Actions** (`.github/workflows/reminders.yml`, lịch 10 phút): đặt secret `APP_URL`, `CRON_SECRET`, **rồi** đặt repository variable `REMINDERS_ENABLED=true`. Chưa đặt biến thì lịch bỏ qua job (không có lần chạy đỏ khi vừa merge mà chưa có secret); nút "Run workflow" luôn chạy để thử. Phút Actions chỉ miễn phí cho repo **công khai**; repo riêng tư ở lịch 10 phút tốn khoảng 4.400 phút/tháng (vượt 2.000 phút miễn phí): đổi lịch sang 30 phút hoặc dùng bộ gọi ngoài.
  - **Bộ gọi ngoài** (cron-job.org hoặc tương tự) với header `Authorization`.
  - **Vercel Cron**: chỉ gói **Pro** (gói Hobby chỉ cho cron mỗi ngày một lần; lịch 10 phút làm deploy thất bại, nên repo không bật sẵn).
- **Nhắc GLV**: chỉ khi hôm nay **nằm trong một học kỳ** (không nhắc dịp hè/giữa hai học kỳ) và lớp **còn ít nhất một em đang học** (lớp trống, vd. cả lớp đã lên lớp, không bị nhắc); lớp có lịch học, hôm nay đúng thứ học, đã qua giờ bắt đầu từ 30 phút đến dưới 3 giờ (giờ Việt Nam) mà buổi học hôm nay chưa có dấu điểm danh nào (buổi huỷ thì không nhắc; dòng đi lễ không tính) → mọi GLV được phân công lớp, một lần mỗi lớp mỗi ngày: "Chưa điểm danh – Lớp A chưa điểm danh hôm nay".
- **Báo trưởng khối**: em đang học ở lớp đang ở trạng thái cảnh báo vắng học (≥ 2 buổi học vắng không phép trong học kỳ hiện tại) hoặc vắng lễ (số tuần không đi lễ ≥ ngưỡng của khối, cùng quy tắc với "Cần chú ý") → trưởng khối của khối đó, một lần mỗi em mỗi học kỳ mỗi loại, gộp thành một thông báo mỗi lần chạy ("Có 2 em đạt ngưỡng cảnh báo vắng học ở Lớp A, Lớp B"), mở "Cần chú ý". "Vừa chạm ngưỡng" nghĩa là lần chạy đầu tiên thấy em ở trạng thái cảnh báo khi trưởng khối đã bật thông báo: lần chạy đầu sau khi triển khai (hoặc sau khi trưởng khối bật thông báo) gửi **một** thông báo gộp cho các cảnh báo đang có. **Không thông báo nào có tên hay số điện thoại của em** (màn hình khoá).
- **Không gửi trùng**: dòng `notification_log` được ghi **trước** khi gửi (`on conflict do nothing`), chỉ gửi khi ghi được; hai lần chạy chồng nhau không gửi hai lần. Dòng chỉ được **giữ khi tới được ít nhất một thiết bị**; không tới thiết bị nào (lỗi mạng, 429/5xx, 401/403, lỗi cục bộ, hoặc mọi thiết bị vừa hết hạn 404/410) thì **nhả dòng** để lần sau thử lại. Số lần thử có giới hạn vì mỗi lần lỗi tăng bộ đếm của đăng ký (xoá sau 5 lần lỗi tạm thời hoặc 10 lần 401/403). Thiết bị vừa hết hạn được đếm là `skipped`, không phải `failed`. Người chưa bật thông báo trên thiết bị nào thì bỏ qua và không ghi dòng (bật sau vẫn nhận được). Mỗi lần chạy có ngân sách 20 giây (route `maxDuration` 60), kiểm trước mỗi lần gửi và sau phần tính ngưỡng: hết thì dừng gọn (`truncated: true`), lần sau làm tiếp.
- **Dọn dẹp mỗi ngày một lần** (cùng lần chạy, chạy cả khi chưa cấu hình VAPID): nhật ký thay đổi cũ hơn 365 ngày, `notification_log` nhắc điểm danh cũ hơn 120 ngày, thông báo ngưỡng cũ hơn 400 ngày (giữ lâu hơn một học kỳ để không báo lại). Nhật ký quét `attendance_scans` không được dọn.

### Xác thực: mọi server action tự kiểm

Proxy (`src/proxy.ts`) **không còn chặn request không phải GET khi thiếu phiên** (để server action tự chuyển hướng đúng giao thức), và `/api/*` nằm ngoài proxy. Vì vậy **mọi server action và mọi route handler phải tự xác thực** bằng `requireUser()` hoặc `getCurrentUser()` (trực tiếp hoặc qua hàm trợ giúp cùng tệp; route quét đi qua `handleScanApi`). Test cấu trúc `src/test/auth-guard.test.ts` quét toàn bộ `src` và **làm test đỏ** nếu một tệp `"use server"` có action không gọi hai hàm đó, hoặc một `route.ts` không tham chiếu `getCurrentUser`/`handleScanApi`. Danh sách miễn trừ rất nhỏ và có lý do ngay trong test: `login` (chưa có phiên), `logout` nội tuyến ở `/tai-khoan` (trang đã gọi `requireUser`), route `/api/health` (công khai) và route cron `/api/cron/nhac-viec` (xác thực bằng `CRON_SECRET`; chỉ được miễn khi chính tệp đó gọi `handleCronRequest(`). Bộ kiểm tra dựa trên văn bản (`src/test/auth-guard-check.ts`, có test riêng); khi thêm action theo dạng lạ (ví dụ bọc bằng hàm khác), test sẽ báo "không nhận dạng được": hãy viết lại theo dạng thường (`export async function` + `await requireUser()`).

### Bảo mật

- **Mã thẻ QR là bí mật nhẹ**: chỉ có tác dụng khi người quét đã đăng nhập và có quyền ghi đúng lớp. Không chia sẻ ảnh chụp thẻ. Mã chỉ được đọc ở `db/queries/qr-cards.ts` và `db/queries/scan.ts` (cùng `services/qr-cards.ts`, `services/scan.ts` để so khớp/cấp lại); các truy vấn thiếu nhi khác cố ý không chọn cột này.
- **`X-Forwarded-Host` chỉ đáng tin sau reverse proxy ghi đè header đó** (Vercel làm vậy). Kiểm tra Origin của API quét dựa vào header này: nếu tự host mà đặt app trực tiếp ra internet, hãy có proxy chuẩn hóa/ghi đè `X-Forwarded-Host`.
- **`NEXT_PUBLIC_E2E_SCAN_BRIDGE` chỉ dùng cho E2E** (cầu nối `window.__scanFeed` đưa mã giả lập vào mà không cần camera; chỉ `playwright.config.ts` đặt biến này, E2E chạy bằng `next dev`). Cầu nối chỉ bật khi biến bằng `1` **và** `NODE_ENV` không phải `production`; điều kiện này bị loại lúc biên dịch nên **bản `next build` không còn chứa mã cầu nối** (kể cả khi lỡ đặt biến; kiểm bằng `grep -r __scanFeed .next/static` sau khi build: không có kết quả). Dù vậy, đừng đặt biến này trên production.
- **Header bảo mật** (`next.config.ts`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (chỉ trang của app được xin camera), và HSTS ở production. `Content-Security-Policy` chặn thật, chỉ nguồn của chính app (`src/lib/security-headers.ts`; `'wasm-unsafe-eval'` cho bộ đọc QR, `'unsafe-eval'` chỉ ở dev hoặc khi đặt `CSP_ALLOW_UNSAFE_EVAL=1`).

## Dùng trên iPhone

App là PWA: mở bằng Safari → Chia sẻ → **Thêm vào Màn hình chính**, rồi mở từ biểu tượng (đăng nhập lại một lần: app cài và tab Safari không chung đăng nhập). Hướng dẫn và danh sách thử trên máy thật: [`docs/ios-checklist.md`](docs/ios-checklist.md).

- **Máy quét QR cần iOS 16+** (WebAssembly dưới CSP chặt). iOS 15 trở xuống chỉ chạy được máy quét khi build với `CSP_ALLOW_UNSAFE_EVAL=1` (CSP yếu hơn); quyết định dựa trên máy thật của GLV.
- **Thông báo đẩy cần iOS 16.4+ và app đã cài lên Màn hình chính** (Safari thường không nhận). Wake Lock (giữ màn hình sáng khi quét) cũng cần iOS 16.4+.
- Camera trong app cài: lần đầu iOS hỏi quyền; bị từ chối thì cấp lại trong Cài đặt (xem mục Camera ở trên).

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

E2E chạy các hành trình trên điện thoại 375px và tablet 768px. Laptop 1280px và PC 1440px có các bộ kiểm tra riêng cho responsive, trang chủ và quản trị hệ thống; không chạy lại toàn bộ hành trình cũ trên desktop.

`pnpm test:pg` dùng cùng máy chủ Postgres đó nhưng tự tạo database riêng `<tên db E2E>_conc` (xóa và migrate lại mỗi lần chạy; tên bắt buộc chứa `e2e`). Thiếu `E2E_DATABASE_URL` thì bộ test được bỏ qua. Không bao giờ trỏ `E2E_DATABASE_URL` vào database thật, và không dán chuỗi kết nối thật vào tài liệu, log hay commit.

### Đo độ trễ

`pnpm bench:scan` gửi 30 lượt quét tuần tự và 30 lượt song song 5 luồng. Giới hạn tốc độ quét là 180 lượt/phút/tài khoản, nên chạy liền nhiều lần sẽ gặp HTTP 429: đợi hết cửa sổ một phút rồi chạy lại. Phương pháp và số đo cục bộ nằm ở `docs/superpowers/qr-baseline.md`; số đo trên hạ tầng thật (cùng vùng với database) là việc của chủ dự án.

## Biểu tượng PWA

`public/icon-192.png`, `public/icon-512.png` và `public/icon-maskable-512.png` (biểu tượng có vùng đệm cho Android) được sinh bằng `node --import tsx scripts/make-icons.ts` (cần Playwright Chromium: `pnpm exec playwright install chromium`). Manifest nằm ở `src/app/manifest.ts`.

## Giới hạn đã biết

- **Lớp cũ trộn nhiều năm** cần ánh xạ tách dữ liệu riêng trước migration `0011`; migration chủ động dừng khi một lớp có buổi thuộc nhiều năm học.
- **Không có chế độ ngoại tuyến thật.** Hàng chờ quét chỉ giữ lượt chưa gửi trên thiết bị tối đa 3 ngày; điểm danh chỉ được ghi khi thiết bị có mạng. **Chạm trên bảng điểm danh (và mục Đi lễ) không có hàng chờ**: cần kết nối ngay lúc bấm.
- **Giới hạn tốc độ nằm trong bộ nhớ từng instance** (quét, bảng tra, bật/gửi thử thông báo đẩy), chưa có bộ đếm dùng chung/phân tán; nhiều instance serverless thì giới hạn thực tế cao hơn.
- **Khóa đăng nhập theo email**, không giới hạn theo IP. Tài khoản bị khóa tạm khi sai quá 5 lần; vẫn thử tiếp thì thời gian khóa kéo dài. Kẻ tấn công biết email của một GLV có thể khóa tài khoản đó.
- **Cần PostgreSQL ≥ 15** (`NULLS NOT DISTINCT`) và **Node >= 22.9** (`Map.groupBy`, `--env-file-if-exists`).
- **Nhắc việc cần bộ gọi ngoài**: Vercel Hobby chỉ cho cron mỗi ngày một lần; dùng GitHub Actions (nhớ `REMINDERS_ENABLED=true`; repo riêng tư tốn phút Actions), cron-job.org hoặc Vercel Pro. Không có `CRON_SECRET`/bộ gọi thì không nhắc và **không dọn nhật ký 365 ngày**; `attendance_scans` không bao giờ được dọn.
- **Cảnh báo vắng lễ** không có cho em chưa từng có dòng điểm danh nào ở lớp hiện tại (không có ngày nhập học): hãy dùng "Đánh vắng các em còn lại" cuối mỗi buổi. Em vào lớp giữa kỳ chỉ được tính từ dòng đầu tiên (heuristic).
- **Kiểm số điện thoại chặt** chặn lưu em có số dạng cũ cho tới khi sửa số; CSV bỏ dòng có số sai.
- **Nhật ký cấp khối/toàn hệ thống** (tài khoản, khối, năm học) được ghi nhưng chưa có trang xem riêng; xếp ghế (`assignSeat`) không được ghi.
- **Lên lớp**: chỗ ngồi cũ không khôi phục khi hoàn tác; không có bước đồng ý của khối đích (xem "Mô hình tin cậy").
- **CSP production chỉ kiểm tay** (E2E chạy `next dev`); xem "Kiểm tra CSP trên bản production". Máy quét trên iOS ≤ 15 cần `CSP_ALLOW_UNSAFE_EVAL=1`.
- Nút tùy chọn trên ô chỗ ngồi là một điều khiển phụ, khá nhỏ.
- **Đảm bảo đồng thời** (advisory lock, `FOR UPDATE`, so sánh-và-ghi) được kiểm thử bằng `pnpm test:pg` trên Postgres thật nhiều kết nối, nhưng chưa thử tải nhiều tiến trình/instance thật.
- Chưa thử trên điện thoại thật (Android/iPhone), chưa thử thông báo đẩy tới máy thật và chưa đo độ trễ trên hạ tầng thật: xem [`docs/superpowers/release-checklist-moc9.md`](docs/superpowers/release-checklist-moc9.md) (việc của chủ dự án).
