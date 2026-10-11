export interface QrDecoder {
  /** Trả chuỗi của mã QR đầu tiên trong khung hình hiện tại, hoặc null. */
  decodeVideo(video: HTMLVideoElement): Promise<string | null>;
}

const WASM_URL = "/zxing_reader.wasm";

export async function createQrDecoder(): Promise<QrDecoder> {
  // Nạp lười: không đưa WASM vào bundle chính; file .wasm tự host (không phụ thuộc CDN, chạy được khi mạng yếu).
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  return {
    async decodeVideo(video) {
      const found = await detector.detect(video);
      return found[0]?.rawValue ?? null;
    },
  };
}
