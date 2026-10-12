import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("QR decoder WASM", () => {
  it("public/zxing_reader.wasm is byte-identical to the installed zxing-wasm reader (run `pnpm qr:wasm` after upgrading)", () => {
    expect(sha256("public/zxing_reader.wasm")).toBe(sha256("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm"));
  });

  it("barcode-detector is pinned to an exact version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    const installed = (JSON.parse(readFileSync("node_modules/barcode-detector/package.json", "utf8")) as { version: string }).version;
    expect(pkg.dependencies["barcode-detector"]).toBe(installed);
    expect(pkg.dependencies["zxing-wasm"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
