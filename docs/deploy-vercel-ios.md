# Triển khai lên Vercel + Postgres và dùng trên iPhone

Hướng dẫn từng bước cho chủ dự án (không cần rành kỹ thuật). Phần chuẩn bị mã (cấu hình Vercel, `/api/health`, `pnpm preflight`) đã có sẵn trong repo. **Các bước tạo tài khoản, tạo database, nhập biến môi trường và bấm Deploy là việc của bạn** vì cần đăng nhập tài khoản của bạn.

Tổng quan: GitHub (mã) → Vercel (chạy web, vùng Singapore `sin1`) → Postgres (cùng vùng Singapore). Điện thoại mở link `https://…vercel.app` bằng Safari rồi thêm vào Màn hình chính.

## 0. Chuẩn bị

- Tài khoản GitHub (repo đã có), tài khoản Vercel (đăng nhập bằng GitHub là dễ nhất).
- Máy tính có Node 22.9+ và pnpm 10 (`pnpm install` đã chạy trong thư mục dự án), cùng `openssl` (có sẵn trên macOS/Linux; Windows dùng Git Bash hoặc WSL).
- **Đẩy mã lên GitHub bằng SSH**: remote `origin` đang là địa chỉ HTTPS, bạn đẩy bằng địa chỉ SSH, ví dụ `git push git@github.com:<tài-khoản>/<repo>.git feat/qr-attendance`. Trước khi push, hook `pre-push` tự chạy `pnpm build` nên push sẽ mất vài chục giây; build lỗi thì push bị chặn (đó là chủ ý).

## 1. Tạo Postgres ở Singapore

Chọn **một** trong hai (đều có gói miễn phí). **Quan trọng: chọn vùng Singapore**, cùng vùng với Vercel `sin1`. Mỗi lượt quét QR cần khoảng 7 lượt đi về tới database, nên nếu database ở xa (ví dụ Mỹ) mỗi lượt quét sẽ chậm gấp nhiều lần.

**Cách A: Neon qua Vercel Marketplace (đơn giản nhất)**
1. Vào Vercel → Storage (hoặc Marketplace) → **Neon** → tạo database, vùng **Singapore (ap-southeast-1)**.
2. Neon cho hai chuỗi kết nối: **Pooled** (host có chữ `-pooler`) và **Direct/Unpooled**. Dùng:
   - `DATABASE_URL` (cho app trên Vercel) = chuỗi **Pooled**.
   - `DATABASE_URL_UNPOOLED` (để chạy migration từ máy bạn) = chuỗi **Unpooled/Direct**.
3. Cả hai nên có đuôi `?sslmode=require`. Neon hay thêm `&channel_binding=require`: **không cần**, app tự bỏ mọi tham số trừ `sslmode` (xem "Tham số lạ trên chuỗi kết nối" dưới), nhưng nên xóa cho gọn.

**Cách B: Supabase**
1. Tạo project tại supabase.com, Region **Southeast Asia (Singapore)**.
2. Project Settings → Database → Connection string:
   - **Direct connection** hoặc **Session pooler** (cổng 5432): dùng cho migration, đặt vào `DATABASE_URL_UNPOOLED`.
   - **Transaction pooler** (cổng 6543): dùng cho app trên Vercel, đặt vào `DATABASE_URL`, **và bắt buộc đặt thêm `DB_PREPARE=false`** (xem mục "Pooler" dưới).
3. Thêm `?sslmode=require` vào cuối chuỗi nếu chưa có. Không cần `?pgbouncer=true` (app tự bỏ).

> Không bao giờ dán chuỗi kết nối (có mật khẩu) vào chat, ảnh chụp màn hình hay tệp trong repo.

### Pooler: khi nào cần `DB_PREPARE=false`

- Serverless (Vercel) mở nhiều kết nối ngắn, nên dùng chuỗi **pooled** cho app. App giữ tối đa `DB_POOL_MAX` kết nối mỗi instance (mặc định 5).
- Pooler **giao dịch của Supabase** (cổng 6543) không giữ "câu lệnh đã chuẩn bị" giữa các lượt: **bắt buộc** đặt `DB_PREPARE=false`, nếu không sẽ có lỗi dạng `prepared statement ... does not exist`. Neon pooled (host có `-pooler`) **hỗ trợ** câu lệnh đã chuẩn bị nên **không bắt buộc** (đặt `false` cũng không sao, chỉ chậm hơn chút). `pnpm preflight` chỉ cảnh báo khi thấy Supabase pooler.
- Với pooler chế độ giao dịch: các **giao dịch thường** (`begin … commit`) và khóa `pg_advisory_xact_lock` (loại khóa gắn với giao dịch, app dùng khi sắp xếp sơ đồ và nhập danh sách thiếu nhi) **chạy đúng**. Thứ có thể hỏng là tính năng gắn với **phiên**: `SET` kéo dài, `LISTEN/NOTIFY`, khóa `pg_advisory_lock` (không phải `_xact_`), bảng tạm. App không dùng các thứ này.
- **Migration** (`drizzle-kit`) nên chạy qua kết nối trực tiếp/session, không qua pooler giao dịch. Vì vậy đặt `DATABASE_URL_UNPOOLED`; nếu có biến này, `pnpm db:migrate` dùng nó thay cho `DATABASE_URL`.

### Tham số lạ trên chuỗi kết nối

Driver Postgres của app chuyển mọi tham số lạ trên chuỗi (ví dụ Neon `channel_binding=require`, Supabase `pgbouncer=true`) thành tham số khởi động của Postgres, và kết nối bị từ chối. Vì vậy app, `pnpm db:migrate`, `pnpm seed` và `pnpm preflight` đều **chỉ giữ `sslmode`** và bỏ phần còn lại trước khi kết nối. `pnpm preflight` báo `[CẢNH BÁO]` kèm tên tham số bị bỏ (không in giá trị). Công cụ ngoài repo (ví dụ `pg_dump`, `psql`) thì hiểu các tham số này bình thường.

## 2. Tạo dự án Vercel từ GitHub

1. Vercel → **Add New… → Project** → chọn repo → **Import**.
2. Framework tự nhận **Next.js**. Vùng chạy `sin1` (Singapore) đã đặt sẵn trong `vercel.json`, không cần chỉnh.
3. **Chưa bấm Deploy**: làm mục 3 (biến môi trường) trước, vì build/chạy cần chúng.
4. Nhánh triển khai production: mặc định là nhánh chính của repo; hãy chọn đúng nhánh bạn muốn (Settings → Git → Production Branch).
5. Gói **Hobby (miễn phí) của Vercel chỉ dành cho mục đích phi thương mại**. Nếu giáo xứ/đoàn thể coi đây là dùng thương mại hoặc có thu phí, cần gói Pro. Hãy tự xác định theo điều khoản hiện hành của Vercel.

## 3. Nhập biến môi trường

Vercel → Project → Settings → **Environment Variables** (áp cho **Production**, và Preview nếu muốn dùng thử):

| Biến | Giá trị | Ghi chú |
|------|---------|---------|
| `DATABASE_URL` | chuỗi kết nối của app (mục 1) | Bắt buộc. Có `?sslmode=require`. |
| `AUTH_SECRET` | chuỗi ngẫu nhiên | Bắt buộc, ≥ 32 ký tự. Sinh trên máy bạn bằng `openssl rand -base64 48` rồi dán vào Vercel. Không dùng lại khóa của máy dev. Đổi khóa này sẽ làm mọi người phải đăng nhập lại. |
| `DB_PREPARE` | `false` | Chỉ khi dùng pooler giao dịch (cổng 6543). |
| `DB_POOL_MAX` | ví dụ `3` | Tùy chọn (1–20, mặc định 5). Gói DB miễn phí có ít kết nối: giảm xuống nếu gặp "too many connections". |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | in ra bởi `pnpm push:keys` | Tùy chọn, để bật thông báo đẩy. Chạy `pnpm push:keys` **trên máy bạn**, chép ba dòng vào Vercel (đổi `VAPID_SUBJECT` thành `mailto:` email liên hệ của giáo xứ hoặc `https://` tên miền của app). `VAPID_PRIVATE_KEY` là bí mật: không commit, không gửi qua chat. Đổi khoá thì mọi thiết bị phải bật lại thông báo (trang Tài khoản tự đăng ký lại nếu quyền đã cấp). Không cần build lại khi đổi, chỉ cần deploy lại để biến có hiệu lực. |
| `CRON_SECRET` | chuỗi ngẫu nhiên | Tùy chọn, để bật nhắc việc tự động (mục 9). ≥ 32 ký tự, sinh trên máy bạn bằng `openssl rand -base64 48`. Bí mật: không commit, không gửi qua chat. Thiếu hoặc ngắn hơn 32 ký tự thì route nhắc việc trả 503 và không chạy. |
| `CSP_ALLOW_UNSAFE_EVAL` | `1` | Tùy chọn, **chỉ** khi có iPhone iOS 15 trở xuống (xem `docs/ios-checklist.md` mục 5). Mặc định bỏ trống. Phải deploy lại sau khi đổi. |

**Không đặt** `NEXT_PUBLIC_E2E_SCAN_BRIDGE` (chỉ dành cho kiểm thử). `DATABASE_URL_UNPOOLED` chỉ cần trên máy bạn khi migrate, không cần đặt trên Vercel. **Không đặt** `PUSH_DRY_RUN` (chỉ dành cho E2E; production luôn bỏ qua nó). `pnpm preflight --prod` cho biết `VAPID_*` và `CRON_SECRET` đã đủ và đúng dạng chưa (không in giá trị).

## 4. Chạy migration và tạo tài khoản đầu tiên (từ máy bạn)

Migration **không tự chạy khi build**: bạn chạy có kiểm soát, một lần cho mỗi lần có migration mới. **Trước khi chạy, tạo bản sao lưu** (mục 8), nhất là khi database đã có dữ liệu thật.

Tạo tệp `.env.local` ở thư mục dự án (tệp này không bị commit) chứa các dòng sau, điền giá trị thật của database production. **Không** đặt `AUTH_SECRET` production vào tệp này (migrate và seed không cần nó):

```
DATABASE_URL=<chuỗi của app (pooled)>
DATABASE_URL_UNPOOLED=<chuỗi direct/session, dùng cho migrate và seed>
DB_PREPARE=false          # chỉ khi DATABASE_URL là Supabase pooler cổng 6543; Neon thì bỏ dòng này
```

Rồi chạy. `pnpm preflight` cần `AUTH_SECRET` để kiểm độ mạnh: nhập tạm bằng `read -rs` chỉ cho lần chạy đó (nhập đúng giá trị đã đặt trên Vercel, hoặc dán khóa vừa sinh):

```bash
read -rs AUTH_SECRET && export AUTH_SECRET
pnpm preflight --prod     # kiểm tra biến, kết nối; lúc này sẽ báo thiếu migration, đó là bình thường
pnpm db:migrate           # áp dụng migration vào database (dùng DATABASE_URL_UNPOOLED nếu có)
pnpm preflight --prod     # kiểm tra lại: không còn mục [LỖI] ("Sẵn sàng"); đọc kỹ các [CẢNH BÁO] nếu có
unset AUTH_SECRET
```

Tạo tài khoản trưởng khối đầu tiên (nhập mật khẩu ẩn, không lưu trong lịch sử lệnh):

```bash
read -rs SEED_PASSWORD && export SEED_PASSWORD
SEED_EMAIL=<email-truong-khoi> pnpm seed
unset SEED_PASSWORD
```

`pnpm seed` ưu tiên `DATABASE_URL_UNPOOLED` (nếu có), và tôn trọng `DB_PREPARE` khi chỉ có chuỗi pooler. Khi xong, **xóa hoặc không giữ** `.env.local` chứa chuỗi production trên máy dùng chung.

`pnpm preflight` kiểm: `DATABASE_URL` hợp lệ và không phải localhost (khi `--prod`), `AUTH_SECRET` đủ dài và không phải giá trị mẫu, không có `NEXT_PUBLIC_E2E_SCAN_BRIDGE`, kết nối được database, và số migration trong database khớp với mã. Nó che mật khẩu và che một phần máy chủ/người dùng khi in; thoát với mã lỗi khác 0 nếu có mục `[LỖI]`.

## 5. Deploy và kiểm tra

1. Vercel → Project → **Deploy** (hoặc push lên nhánh production).
2. Khi xong, mở `https://<tên-dự-án>.vercel.app/api/health`. Mong đợi:
   ```json
   {"ok":true,"db":true,"version":"a1b2c3d"}
   ```
   `version` là 7 ký tự đầu của commit. Nếu thấy `"db":false` (mã HTTP 503): kiểm tra `DATABASE_URL`, `sslmode`, `DB_PREPARE`, và database có đang "ngủ" không (Neon gói miễn phí tự ngủ khi nhàn rỗi, lần gọi đầu có thể chậm vài giây, thử lại).
3. Mở `https://<tên-dự-án>.vercel.app`, đăng nhập bằng tài khoản vừa tạo.
4. Tạo khối/lớp/GLV theo mục "Quy trình sử dụng" trong `README.md`.

## 6. Dùng trên iPhone

Làm theo `docs/ios-checklist.md` (cài lên Màn hình chính, danh sách việc cần thử trên máy thật). Tóm tắt:

1. Mở link bằng **Safari** (không mở trong Zalo/Messenger).
2. Chia sẻ → **Thêm vào Màn hình chính** → Thêm.
3. Mở app từ biểu tượng, **đăng nhập lại** (app cài và tab Safari không chung đăng nhập).
4. Vào một buổi điểm danh → **Quét QR** → cho phép camera → quét thử một thẻ in. iOS hỏi quyền camera mỗi lần mở app, đó là bình thường.

## 7. Đo độ trễ quét trên hạ tầng thật

`pnpm bench:scan` đo đường quét qua HTTP. Nó **ghi vào database** (tạo rồi xóa một buổi tạm) và cần dữ liệu mẫu E2E, nên **không chạy trên database production**. Cách làm an toàn:

1. Tạo một database **riêng, tên chứa `e2e`** (ví dụ `diemdanh_e2e`) cùng vùng Singapore. Neon: tạo database mới tên `diemdanh_e2e` trong cùng project (hoặc một branch). Supabase: database mặc định luôn tên `postgres` (không chứa `e2e` nên script từ chối), vì vậy vào SQL Editor của project **bench** (không phải project thật) chạy `create database diemdanh_e2e;` rồi dùng chuỗi **direct** của database đó (đổi tên database ở cuối chuỗi thành `diemdanh_e2e`).
2. Nạp dữ liệu mẫu (lệnh này **xóa sạch** schema của database trỏ tới, vì vậy chỉ dùng cho database `e2e`; script từ chối nếu tên không chứa `e2e`):
   ```bash
   E2E_DATABASE_URL='<chuỗi kết nối của database e2e>' pnpm bench:seed
   ```
3. Tạo **dự án Vercel thứ hai** từ cùng repo (ví dụ `diemdanh-bench`), vùng `sin1`, với `DATABASE_URL` = chuỗi database e2e, `AUTH_SECRET` = một khóa riêng, và **tắt Deployment Protection** (Settings → Deployment Protection) để script gọi được không cần đăng nhập Vercel. Xóa dự án này sau khi đo.
4. Chạy từ máy bạn (nhập khóa bằng `read -rs`, không dán lộ):
   ```bash
   read -rs AUTH_SECRET && export AUTH_SECRET
   BENCH_BASE_URL='https://diemdanh-bench.vercel.app' E2E_DATABASE_URL='<chuỗi database e2e>' pnpm bench:scan
   unset AUTH_SECRET
   ```
5. Chạy thêm `pnpm preflight --prod` (mục 4) bất cứ lúc nào để kiểm lại cấu hình.

Cách đọc kết quả:

- Mỗi lần chạy gồm ~63 lượt quét; **giới hạn 180 lượt/phút/tài khoản** (trả HTTP 429). Vì vậy đừng chạy liên tiếp quá 2 lần trong một phút, chờ một phút giữa các lần.
- Một lượt quét tốn khoảng **7 lượt đi về tới database**, nên thời gian máy chủ ≈ **7 × RTT** (RTT = độ trễ mạng giữa app và database). App và database cùng vùng thì RTT vài ms, tức khoảng 35 ms cộng xử lý.
- Số tốt: **p95 phía máy chủ dưới khoảng 300 ms** (mục tiêu chặt hơn trong `docs/superpowers/qr-baseline.md` là ≤ 100 ms khi cùng vùng). Cộng thêm độ trễ mạng từ điện thoại tới Vercel, người quét vẫn thấy dưới ~1 giây.
- Nếu p95 cao hơn nhiều (ví dụ trên 300 ms): kiểm tra vùng app và vùng database có cùng Singapore không (nguyên nhân thường gặp nhất), chuỗi `DATABASE_URL` có đúng loại pooled không; lần chạy đầu sau khi database "ngủ" luôn chậm hơn.
- Ghi kết quả vào bảng "hosted" ở cuối `docs/superpowers/qr-baseline.md`.

## 8. Chi phí, sao lưu, quay lui

**Chi phí.** Neon và Supabase đều có gói miễn phí đủ cho một giáo xứ nhỏ (giới hạn dung lượng, giờ chạy và kết nối; gói miễn phí có thể tự ngủ khi nhàn rỗi). Vercel Hobby miễn phí nhưng **chỉ cho mục đích phi thương mại**; xem điều khoản hiện hành và nâng lên Pro nếu cần. Kiểm trang giá của từng nhà cung cấp vì giới hạn thay đổi theo thời gian.

**Sao lưu Postgres.**
- Bật sao lưu của nhà cung cấp: Neon có khôi phục theo thời điểm (PITR) trong cửa sổ giới hạn của từng gói; Supabase có sao lưu hằng ngày ở gói trả phí. Gói miễn phí thường có ít hoặc không có, nên **tự xuất định kỳ**.
- Xuất thủ công bằng `pg_dump` bằng chuỗi **Direct/Unpooled**: `pg_dump "$DATABASE_URL_UNPOOLED" --format=custom --file=diemdanh-$(date +%F).dump` (đặt biến trong shell, không gõ chuỗi trực tiếp vào lệnh). Lưu tệp ở nơi an toàn: có tên và số điện thoại thiếu nhi.
- **Luôn sao lưu ngay trước khi chạy `pnpm db:migrate`.**
- Thử khôi phục vào một database trống ít nhất một lần để biết bản sao lưu dùng được.

**Quay lui (rollback).**
- Mã: Vercel → Deployments → chọn bản trước đó → **Instant Rollback** (hoặc "Promote to Production"). Mất vài giây, không cần build lại.
- Migration **chỉ đi tới** (không có lệnh lùi). Vì vậy: sao lưu trước khi migrate; viết migration tương thích ngược (thêm cột/bảng, không xóa ngay) để bản mã cũ vẫn chạy được trên database mới; nếu migration hỏng dữ liệu, khôi phục từ bản sao lưu (PITR hoặc dump), rồi mới rollback mã.
- `pnpm preflight --prod` cho biết database đang ở số migration nào so với mã.

## 9. Nhắc việc tự động

App có route `/api/cron/nhac-viec`. Mỗi lần được gọi, nó gửi các thông báo đẩy đến hạn rồi dọn dẹp. Route **không tự chạy**: cần một bộ hẹn giờ gọi nó khoảng 10 phút một lần.

**Mỗi thông báo nghĩa là gì**
- **"Chưa điểm danh – Lớp A chưa điểm danh hôm nay"** (gửi GLV được phân công lớp). Lớp có lịch học (đặt ở trang lớp), hôm nay đúng thứ học, đã qua giờ bắt đầu từ 30 phút đến dưới 3 giờ (giờ Việt Nam), mà buổi học hôm nay chưa có dấu điểm danh nào. Buổi bị huỷ thì không nhắc. Mỗi lớp mỗi ngày nhắc một lần. Bấm vào thông báo mở trang điểm danh hôm nay.
- **"Cảnh báo vắng học" / "Cảnh báo vắng lễ"** (gửi trưởng khối). Gửi khi lần chạy thấy có em đang học ở lớp trong khối đang ở trạng thái cảnh báo trong học kỳ hiện tại mà trưởng khối chưa được báo về em đó:
  - vắng học: từ 2 buổi học vắng không phép trở lên;
  - vắng lễ: số tuần không đi lễ đạt ngưỡng của khối (cùng quy tắc với trang "Cần chú ý").

  Mỗi em được báo một lần mỗi học kỳ cho mỗi loại. **Lần chạy đầu tiên sau khi triển khai** (hoặc sau khi một trưởng khối bật thông báo) sẽ gửi **một** thông báo gộp cho mọi cảnh báo đang có; sau đó chỉ báo em mới chạm ngưỡng. Nhiều em trong cùng một lần chạy được gộp thành một thông báo ("Có 2 em đạt ngưỡng cảnh báo vắng học ở Lớp A, Lớp B"). Bấm vào mở "Cần chú ý".
- Thông báo hiện cả trên màn hình khoá nên **chỉ có tên lớp và số em**, không bao giờ có tên hay số điện thoại của em.
- Một người chỉ nhận thông báo khi đã bấm "Bật thông báo" ở trang Tài khoản trên ít nhất một thiết bị. **iPhone/iPad**: cần iOS 16.4 trở lên và app phải được **Thêm vào Màn hình chính** rồi mở từ biểu tượng đó (mục 6). Safari thường không nhận thông báo đẩy.

**Bước 1: tạo `CRON_SECRET`.** Trên máy bạn chạy `openssl rand -base64 48`. Dán kết quả vào Vercel → Settings → Environment Variables (Production) với tên `CRON_SECRET`, rồi deploy lại. Cần thêm `VAPID_*` (mục 3); thiếu `VAPID_*` thì route chỉ dọn dẹp, không gửi gì.

**Bước 2: thử bằng tay** (thay tên miền của bạn):
```bash
read -rs CRON_SECRET   # dán bí mật rồi Enter (không hiện ra màn hình, không vào lịch sử lệnh)
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" | curl -sS --fail --max-time 65 -H @- https://ten-app.vercel.app/api/cron/nhac-viec
unset CRON_SECRET
```
Kết quả đúng là `{"sent":0,"skipped":…,"failed":0,"pruned":…,"truncated":false}`. Ý nghĩa các số:
- `sent`: số thông báo đã tới ít nhất một thiết bị;
- `skipped`: số thông báo bỏ qua vì đã gửi rồi hoặc người nhận chưa bật thông báo;
- `failed`: số thông báo không tới được thiết bị nào vì lỗi (lỗi mạng, dịch vụ push quá tải, khoá sai); lần chạy sau **thử lại** (có giới hạn: đăng ký lỗi liên tục bị xoá sau 5 hoặc 10 lần);
- `truncated`: `true` khi lần chạy dừng vì hết ngân sách 20 giây; phần còn lại làm ở lần sau.
- `pruned`: số dòng nhật ký cũ đã dọn.

Các mã lỗi:
- **401**: sai hoặc thiếu bí mật;
- **503**: `CRON_SECRET` chưa đặt hoặc ngắn hơn 32 ký tự trên Vercel.

Gọi lại ngay một lần nữa sẽ không gửi trùng.

**Bước 3: chọn một cách gọi định kỳ** (chỉ dùng một cách):

- **(a) GitHub Actions** (miễn phí, đã có sẵn tệp `.github/workflows/reminders.yml`). Trên GitHub vào repo → Settings → Secrets and variables → Actions → **New repository secret**, tạo hai secret:
  - `APP_URL` = `https://ten-app.vercel.app` (không có `/` ở cuối);
  - `CRON_SECRET` = cùng giá trị như trên Vercel.

  Workflow chạy mỗi 10 phút và có nút **Run workflow** để thử ngay. Lưu ý:
  - lịch của GitHub có thể trễ vài phút đến hơn chục phút lúc cao điểm, và khoảng cách tối thiểu là 5 phút;
  - cửa sổ nhắc kéo dài 2 tiếng rưỡi nên trễ như vậy vẫn ổn;
  - lịch chỉ chạy trên **nhánh mặc định** (thường là `main`): tệp workflow phải nằm ở nhánh đó;
  - GitHub tự **tắt** lịch khi repo không có hoạt động (commit) trong 60 ngày; sẽ có email báo, vào tab Actions bấm bật lại;
  - thiếu secret hoặc `APP_URL` không bắt đầu bằng `https://` thì lần chạy **báo lỗi đỏ** (để bạn thấy ngay), không im lặng bỏ qua; dấu `/` cuối được tự bỏ;
  - bí mật được đưa vào curl qua stdin, không nằm trên dòng lệnh, và không bao giờ được in ra log.
- **(b) cron-job.org** (hoặc dịch vụ hẹn giờ tương tự). Tạo job với:
  - URL `https://ten-app.vercel.app/api/cron/nhac-viec`, phương thức GET, mỗi 10 phút;
  - mục Headers thêm `Authorization` = `Bearer <CRON_SECRET>`;
  - tắt lưu nội dung phản hồi nếu có tuỳ chọn.

  Bí mật nằm ở dịch vụ đó, nên chỉ dùng dịch vụ bạn tin cậy.
- **(c) Vercel Cron** (chỉ gói **Pro**). Gói Hobby chỉ cho cron chạy **mỗi ngày một lần**, và lịch mỗi 10 phút sẽ làm **deploy thất bại**, vì vậy repo **không** bật sẵn. Nếu dùng Pro, thêm vào `vercel.json`:
  ```json
  "crons": [{ "path": "/api/cron/nhac-viec", "schedule": "*/10 * * * *" }]
  ```
  Vercel tự gửi header `Authorization: Bearer <CRON_SECRET>` khi biến `CRON_SECRET` đã đặt. Nhớ sửa test `src/test/vercel-config.test.ts` (đang khoá "không có `crons`").

**An toàn**
- Không có bí mật thì route không bao giờ chạy (503).
- Bí mật không bao giờ được in ra log hay phản hồi.
- Phản hồi chỉ gồm số đếm và có `Cache-Control: no-store`.
- Hai lần gọi chồng nhau không gửi trùng: mỗi thông báo được ghi vào `notification_log` **trước** khi gửi. Dòng được giữ khi tới được ít nhất một thiết bị; không tới thiết bị nào thì dòng được nhả để lần sau thử lại.

**Dọn dẹp** (mỗi ngày một lần trong lần chạy đầu tiên của ngày):
- xoá nhật ký thay đổi cũ hơn 12 tháng;
- xoá nhật ký thông báo cũ.

Dán bí mật cẩn thận: khoảng trắng/xuống dòng ở đầu cuối được app tự cắt, nhưng nơi gọi có thể gửi nguyên văn, nên hãy xoá chúng ở mọi nơi (`pnpm preflight --prod` cảnh báo nếu có). Đổi bí mật: tạo giá trị mới, cập nhật ở Vercel (deploy lại) và ở nơi gọi (GitHub secret/cron-job.org) cùng lúc.

## 10. Sau này

- Thông báo đẩy và nhắc việc đã có (mục 3, 9). Có thể thêm loại nhắc khác bằng cách mở rộng `src/server/services/reminders.ts`.
- Danh sách việc kiểm trước khi dùng thật: `docs/superpowers/qr-release-checklist.md`.
