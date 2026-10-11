import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Điểm danh Giáo lý",
    short_name: "Điểm danh",
    description: "Điểm danh lớp giáo lý theo sơ đồ chỗ ngồi",
    lang: "vi",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f1e6",
    theme_color: "#2f5d46",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
