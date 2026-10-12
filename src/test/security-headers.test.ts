import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("security headers (next.config.ts)", () => {
  it("allows the camera only for this origin and denies microphone and geolocation", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    expect(all).toContainEqual({ key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" });
    expect(all.map((h) => h.key)).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]));
  });

  it("serves the push-only service worker as uncached JavaScript", async () => {
    const rules = await nextConfig.headers!();
    const sw = rules.find((r) => r.source === "/sw.js")!.headers;
    expect(sw).toEqual(expect.arrayContaining([
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
    ]));
  });
});
