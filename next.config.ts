import type { NextConfig } from "next";
import { SERVICE_WORKER_HEADERS, buildSecurityHeaders, cspOptionsFromEnv } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Tách đầu ra khi kiểm thử/xem thử cùng lúc với một phiên build khác.
  distDir: process.env.NEXT_OUTPUT_DIR || ".next",
  // Thanh điều hướng điện thoại nằm ở đáy, tránh biểu tượng dev che vùng chạm.
  devIndicators: false,
  async headers() {
    return [
      { source: "/:path*", headers: buildSecurityHeaders(cspOptionsFromEnv(process.env)) },
      { source: "/sw.js", headers: [...SERVICE_WORKER_HEADERS] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
