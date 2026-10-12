import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z as zod } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  zod.config({ jitless: false }); // cấu hình của zod là toàn cục: trả về mặc định cho test sau
});

describe("zod dùng chung server/trình duyệt", () => {
  it("trong trình duyệt tắt JIT (không gọi Function() => không vi phạm CSP thiếu 'unsafe-eval')", async () => {
    vi.stubGlobal("window", {});
    const { z } = await import("./zod");
    expect(z.config().jitless).toBe(true);
  });

  it("trên server giữ JIT (không làm chậm đường quét)", async () => {
    const { z } = await import("./zod");
    expect(z.config().jitless).not.toBe(true);
  });

  it("code chạy được ở trình duyệt không import zod trực tiếp (phải qua @/lib/zod)", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
    });
    const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");
    // src/lib và src/components: dùng chung/được client import. src/app: chỉ file "use client" (page/route/actions
    // không có "use client" chạy trên server). src/server: chỉ server, được import thẳng.
    const isClientReachable = (file: string, src: string) =>
      /^src\/(lib|components)\//.test(file) || /^\s*["']use client["']/m.test(src);
    const direct = ["src/lib", "src/components", "src/app"]
      .flatMap((d) => walk(path.join(process.cwd(), d)))
      .map((f) => ({ file: rel(f), src: readFileSync(f, "utf8") }))
      .filter(({ file, src }) => file !== "src/lib/zod.ts" && /from ["']zod(\/[^"']*)?["']/.test(src) && isClientReachable(file, src))
      .map(({ file }) => file);
    expect(direct).toEqual([]);
  });
});
