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

## Kiểm thử

```bash
pnpm test        # unit + tích hợp (PGlite, không cần Postgres thật)
pnpm test:cov    # kèm coverage, ép ngưỡng: lines/functions/statements 80%, branches 70%
pnpm test:e2e    # Playwright, cần database E2E riêng (xem bên dưới)
```

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

## Biểu tượng PWA

`public/icon-192.png`, `public/icon-512.png` và `public/icon-maskable-512.png` (biểu tượng có vùng đệm cho Android) được sinh bằng `node --import tsx scripts/make-icons.ts` (cần Playwright Chromium: `pnpm exec playwright install chromium`). Manifest nằm ở `src/app/manifest.ts`.

## Triển khai lên Vercel

1. Đặt `DATABASE_URL` và `AUTH_SECRET` trong Project Settings, mục Environment Variables, cho cả môi trường Production và Preview. `DATABASE_URL` chỉ cần lúc chạy: `src/db/client.ts` kết nối lười ở lần truy vấn đầu tiên nên `next build` không cần biến này (thiếu biến thì lần truy vấn đầu báo lỗi rõ ràng).
2. Trước mỗi lần deploy có migration mới, chạy `pnpm db:migrate` với `DATABASE_URL` trỏ tới database production.
3. Không commit `.env*` vào git.

## Giới hạn đã biết

- **Phiên đăng nhập không thu hồi được từ máy chủ.** Đăng xuất hoặc đặt lại mật khẩu không vô hiệu hóa cookie đã cấp, cookie vẫn dùng được tối đa 7 ngày. Cần thêm cột phiên bản phiên (session version) để khắc phục.
- **Khóa đăng nhập theo email**, không giới hạn theo IP. Tài khoản bị khóa tạm khi sai quá 5 lần; vẫn thử tiếp thì thời gian khóa kéo dài. Kẻ tấn công biết email của một GLV có thể khóa tài khoản đó.
- **Chưa hỗ trợ chế độ ngoại tuyến** (ngoài phạm vi bản này).
- **Cần Node >= 22.9** do dùng `Map.groupBy` và cờ `--env-file-if-exists`.
- Nút tùy chọn trên ô chỗ ngồi là một điều khiển phụ, khá nhỏ.
- **Đảm bảo đồng thời** (advisory lock, `FOR UPDATE`) mới chỉ được kiểm thử trên PGlite và lượt E2E một tiến trình, chưa thử tải nhiều tiến trình trên Postgres thật.
# giaoly-diemdanh
