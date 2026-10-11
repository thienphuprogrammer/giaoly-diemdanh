import { copyFileSync, existsSync } from "node:fs";

const candidates = [
  "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
  "node_modules/zxing-wasm/dist/zxing_reader.wasm",
];
const src = candidates.find((p) => existsSync(p));
if (!src) throw new Error("Không tìm thấy zxing_reader.wasm trong node_modules/zxing-wasm; xem README của thư viện");
copyFileSync(src, "public/zxing_reader.wasm");
console.log(`Đã chép ${src} -> public/zxing_reader.wasm`);
