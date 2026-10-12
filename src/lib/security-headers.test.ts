import { describe, expect, it } from "vitest";
import { buildCsp, buildSecurityHeaders, CSP_HEADER, cspOptionsFromEnv } from "./security-headers";

const directives = (csp: string) =>
  new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name, values] as const;
  }));

describe("buildCsp", () => {
  it("cho phép WASM của bộ giải mã QR nhưng không cho eval ở bản production", () => {
    const d = directives(buildCsp({ isProd: true }));
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]);
  });

  it("chỉ thêm 'unsafe-eval' cho bản dev (React refresh)", () => {
    const d = directives(buildCsp({ isProd: false }));
    expect(d.get("script-src")).toContain("'unsafe-eval'");
    expect(d.get("script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("CSP_ALLOW_UNSAFE_EVAL: thêm 'unsafe-eval' ở production (iPhone iOS ≤ 15 cần để chạy WebAssembly)", () => {
    const d = directives(buildCsp({ isProd: true, allowUnsafeEval: true }));
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "'unsafe-eval'"]);
    expect(buildCsp({ isProd: true, allowUnsafeEval: false })).toBe(buildCsp({ isProd: true }));
  });

  it("dev đã có 'unsafe-eval' thì cờ không thêm lần nữa", () => {
    const d = directives(buildCsp({ isProd: false, allowUnsafeEval: true }));
    expect(d.get("script-src")?.filter((v) => v === "'unsafe-eval'")).toHaveLength(1);
  });

  it("khóa các nguồn còn lại về chính trang", () => {
    const d = directives(buildCsp({ isProd: true }));
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(d.get("media-src")).toEqual(["'self'", "blob:"]);
    expect(d.get("worker-src")).toEqual(["'self'", "blob:"]);
    expect(d.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("font-src")).toEqual(["'self'", "data:"]);
    expect(d.get("manifest-src")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
  });

  it("không có nguồn bên ngoài nào (không CDN, không https: chung)", () => {
    for (const isProd of [true, false]) {
      expect(buildCsp({ isProd })).not.toMatch(/https?:|\*/);
    }
  });
});

describe("buildSecurityHeaders", () => {
  const get = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

  it("giữ camera=(self) và chặn micro/vị trí", () => {
    const h = buildSecurityHeaders({ isProd: true });
    expect(get(h, "Permissions-Policy")).toBe("camera=(self), microphone=(), geolocation=()");
  });

  it("CSP chặn thật (đã chạy Report-Only sạch qua E2E dev và bản production)", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy");
  });

  it("gửi CSP ở chế độ đang dùng, không gửi cả hai", () => {
    const h = buildSecurityHeaders({ isProd: true });
    expect(get(h, CSP_HEADER)).toBe(buildCsp({ isProd: true }));
    expect(h.filter((x) => x.key.startsWith("Content-Security-Policy"))).toHaveLength(1);
  });

  it("chuyển cờ unsafe-eval xuống CSP", () => {
    const h = buildSecurityHeaders({ isProd: true, allowUnsafeEval: true });
    expect(get(h, CSP_HEADER)).toBe(buildCsp({ isProd: true, allowUnsafeEval: true }));
  });

  it("đọc cờ từ biến môi trường: chỉ đúng \"1\" mới bật", () => {
    expect(cspOptionsFromEnv({ NODE_ENV: "production" })).toEqual({ isProd: true, allowUnsafeEval: false });
    expect(cspOptionsFromEnv({ NODE_ENV: "production", CSP_ALLOW_UNSAFE_EVAL: "1" })).toEqual({ isProd: true, allowUnsafeEval: true });
    expect(cspOptionsFromEnv({ NODE_ENV: "production", CSP_ALLOW_UNSAFE_EVAL: "true" })).toEqual({ isProd: true, allowUnsafeEval: false });
    expect(cspOptionsFromEnv({ NODE_ENV: "development" })).toEqual({ isProd: false, allowUnsafeEval: false });
  });

  it("chỉ gửi HSTS ở production", () => {
    expect(get(buildSecurityHeaders({ isProd: true }), "Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(get(buildSecurityHeaders({ isProd: false }), "Strict-Transport-Security")).toBeUndefined();
  });

  it("giữ các header cũ", () => {
    const h = buildSecurityHeaders({ isProd: false });
    expect(get(h, "X-Frame-Options")).toBe("DENY");
    expect(get(h, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(h, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(h, CSP_HEADER)).toBe(buildCsp({ isProd: false }));
  });
});
