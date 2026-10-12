/**
 * Header bảo mật cho mọi trang (next.config.ts dùng). Logic thuần để test được, không import gì của Next.
 */
export interface SecurityHeader { key: string; value: string }

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
 * - `'unsafe-eval'` chỉ ở dev (React refresh/Turbopack HMR).
 * - `style-src 'unsafe-inline'`: thuộc tính `style` của React và style inline của next/font.
 * - next/font/google tự host font lúc build => `font-src 'self'` (thêm `data:` cho font nhúng nếu có).
 * - `blob:` cho ảnh/video/worker sinh tại chỗ (camera, tải tệp).
 */
export function buildCsp({ isProd }: { isProd: boolean }): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(isProd ? [] : ["'unsafe-eval'"])]],
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

export function buildSecurityHeaders({ isProd }: { isProd: boolean }): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Máy quét cần camera của chính trang; không trang nào cần micro hay vị trí.
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    { key: CSP_HEADER, value: buildCsp({ isProd }) },
    ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ];
}
