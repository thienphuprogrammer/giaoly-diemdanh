import type { NextConfig } from "next";
import { buildSecurityHeaders, cspOptionsFromEnv } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders(cspOptionsFromEnv(process.env)) }];
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
