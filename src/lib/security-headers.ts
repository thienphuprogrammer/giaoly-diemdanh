/**
 * Header bảo mật cho mọi trang (next.config.ts dùng). Logic thuần để test được, không import gì của Next.
 */
export interface SecurityHeader { key: string; value: string }

export interface CspOptions {
  isProd: boolean;
  /**
   * Thêm 'unsafe-eval' ở production. iPhone iOS 15 trở xuống chưa hiểu 'wasm-unsafe-eval' nên chặn WebAssembly
   * (máy quét không đọc được mã QR) trừ khi có 'unsafe-eval'. Mặc định tắt (CSP chặt, máy quét cần iOS 16+);
   * bật bằng biến môi trường `CSP_ALLOW_UNSAFE_EVAL=1` lúc build/chạy server, đổi lại CSP yếu hơn.
   */
  allowUnsafeEval?: boolean;
}

/** Đọc tùy chọn CSP từ biến môi trường (next.config.ts gọi lúc nạp cấu hình, phía server). */
export function cspOptionsFromEnv(env: Record<string, string | undefined>): Required<CspOptions> {
  return { isProd: env.NODE_ENV === "production", allowUnsafeEval: env.CSP_ALLOW_UNSAFE_EVAL === "1" };
}

/**
 * Chặn thật. Đã chạy thử `Content-Security-Policy-Report-Only` qua toàn bộ E2E (dev) và qua bản `next build`
 * (production): vi phạm duy nhất là zod dò JIT bằng `Function("")`, đã tắt ở trình duyệt (xem src/lib/zod.ts).
 * Muốn quay lại chế độ chỉ báo cáo: đổi về "Content-Security-Policy-Report-Only".
 */
export const CSP_HEADER = "Content-Security-Policy";

/**
 * CSP chỉ cho nguồn của chính trang.
 * - `script-src 'unsafe-inline'`: Next chèn script inline (dữ liệu RSC `self.__next_f.push`, bootstrap). Muốn bỏ thì
 *   phải dùng nonce theo từng request qua proxy, buộc mọi trang render động; chưa đáng với app nội bộ không có HTML
 *   do người dùng nhập (React luôn escape).
 * - `'wasm-unsafe-eval'`: bộ giải mã QR `zxing_reader.wasm` (WebAssembly.instantiate), không mở `eval` của JS.
 * - `'unsafe-eval'` chỉ ở dev (React refresh/Turbopack HMR), hoặc khi bật `allowUnsafeEval` (iPhone iOS ≤ 15).
 * - `style-src 'unsafe-inline'`: thuộc tính `style` của React và style inline của next/font.
 * - next/font/google tự host font lúc build => `font-src 'self'` (thêm `data:` cho font nhúng nếu có).
 * - `blob:` cho ảnh/video/worker sinh tại chỗ (camera, tải tệp).
 */
export function buildCsp({ isProd, allowUnsafeEval = false }: CspOptions): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isProd && !allowUnsafeEval ? [] : ["'unsafe-eval'"])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'"]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["object-src", ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function buildSecurityHeaders({ isProd, allowUnsafeEval = false }: CspOptions): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Máy quét cần camera của chính trang; không trang nào cần micro hay vị trí.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    { key: CSP_HEADER, value: buildCsp({ isProd, allowUnsafeEval }) },
    ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ];
}

/**
 * `/sw.js` (chỉ cho thông báo đẩy): không cache để bản sửa đến ngay, đúng kiểu JavaScript (trình duyệt từ chối đăng ký
 * service worker có MIME khác). Header bảo mật chung vẫn áp dụng (CSP `worker-src 'self'`).
 */
export const SERVICE_WORKER_HEADERS: readonly SecurityHeader[] = [
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
];
