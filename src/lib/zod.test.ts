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

  it("code dùng chung trong src/lib import zod qua @/lib/zod", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });
    const libDir = path.join(process.cwd(), "src/lib");
    const direct = walk(libDir)
      .filter((f) => !f.endsWith(`${path.sep}zod.ts`) && /from "zod"/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(direct).toEqual([]);
  });
});
