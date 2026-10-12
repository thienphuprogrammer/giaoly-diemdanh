import type { Metadata, Viewport } from "next";

/** Màu nền trang (`--page`): thanh trạng thái, nền khởi động và theme dùng chung một màu sáng. */
export const APP_COLORS = { theme: "#f8fafc", background: "#f8fafc" } as const;

export interface IosSplash { url: string; cssWidth: number; cssHeight: number; ratio: number }

/**
 * Ảnh khởi động iOS (chỉ dùng khi đã "Thêm vào Màn hình chính"; thiếu thì iOS hiện màn trắng). iOS chỉ nhận ảnh
 * khớp đúng kích thước máy nên chỉ làm cho các cỡ iPhone phổ biến; máy khác vẫn thấy màn nền sáng như trước.
 * Sinh bằng `scripts/make-icons.ts`.
 */
export const IOS_SPLASH: readonly IosSplash[] = [
  { url: "/splash/iphone-1170x2532.png", cssWidth: 390, cssHeight: 844, ratio: 3 }, // iPhone 12/13/14, 13/12 Pro
  { url: "/splash/iphone-1179x2556.png", cssWidth: 393, cssHeight: 852, ratio: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { url: "/splash/iphone-1290x2796.png", cssWidth: 430, cssHeight: 932, ratio: 3 }, // iPhone 14 Pro Max, 15 Plus/Pro Max, 16 Plus
];

const splashMedia = (s: IosSplash) =>
  `(device-width: ${s.cssWidth}px) and (device-height: ${s.cssHeight}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`;

export const appMetadata: Metadata = {
  title: "Điểm danh Giáo lý",
  description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  /*
   * statusBarStyle "default": thanh trạng thái nền sáng chữ tối, nội dung bắt đầu dưới thanh (safe-area-inset-top = 0
   * khi dọc). App chỉ có giao diện sáng nên hợp màu; "black-translucent" sẽ cho nội dung chui dưới thanh trạng thái,
   * chữ trắng trên nền sáng khó đọc và mọi header phải chừa thêm khoảng trên.
   */
  appleWebApp: {
    capable: true,
    title: "Điểm danh",
    statusBarStyle: "default",
    startupImage: IOS_SPLASH.map((s) => ({ url: s.url, media: splashMedia(s) })),
  },
  formatDetection: { telephone: false },
  // Next 16 in `mobile-web-app-capable`; iOS trước 16.4 (không đọc manifest đầy đủ) cần tên có tiền tố apple.
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * `viewport-fit=cover` để nội dung phủ cả vùng tai thỏ/home indicator; các thanh cố định tự chừa bằng
 * `env(safe-area-inset-*)` (xem tiện ích `*-safe` trong globals.css). Không đặt `maximum-scale`/`user-scalable`:
 * phóng to vẫn phải dùng được (trợ năng); màn quét tự chặn zoom bằng `touch-action` riêng.
 */
export const appViewport: Viewport = {
  themeColor: APP_COLORS.theme,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
