import type { NextConfig } from "next";
import { SERVICE_WORKER_HEADERS, buildSecurityHeaders, cspOptionsFromEnv } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
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
