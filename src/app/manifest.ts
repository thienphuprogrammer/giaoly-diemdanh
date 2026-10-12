import type { MetadataRoute } from "next";
import { APP_COLORS } from "./pwa-meta";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Điểm danh Giáo lý",
    short_name: "Điểm danh",
    description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
    lang: "vi",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Không khóa hướng xoay: máy tính bảng/ngang vẫn dùng được bảng điểm danh.
    background_color: APP_COLORS.background,
    theme_color: APP_COLORS.theme,
    categories: ["education", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android/Chrome: nhấn giữ icon. iOS bỏ qua.
    shortcuts: [
      { name: "Lớp của tôi", url: "/", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Cần chú ý", url: "/can-chu-y", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
