// @vitest-environment node
import QRCode from "qrcode";
import { readBarcodes } from "zxing-wasm/reader";
import { describe, expect, it } from "vitest";

/** Vẽ ma trận module của qrcode thành ImageData (đen/trắng, lề 4 module) để zxing đọc. */
function toImageData(text: string, scale = 8) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const quiet = 4;
  const side = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx;
          data.fill(0, px * 4, px * 4 + 3);
        }
      }
    }
  }
  return { data, width: side, height: side, colorSpace: "srgb" as const };
}

const CODE = "0123456789abcdef0123456789abcdef";

describe("QR round trip", () => {
  it("decodes the exact payload we print", async () => {
    const payload = `dd1.${CODE}`; // đúng định dạng Task 16 sẽ chuẩn hóa thành formatQrPayload
    const [hit] = await readBarcodes(toImageData(payload), { formats: ["QRCode"] });
    expect(hit?.text).toBe(payload);
  });

  it("still decodes at a small on-screen size (4px per module)", async () => {
    const payload = `dd1.${CODE}`;
    const [hit] = await readBarcodes(toImageData(payload, 4), { formats: ["QRCode"] });
    expect(hit?.text).toBe(payload);
  });
});
