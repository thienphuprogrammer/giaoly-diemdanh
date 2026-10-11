import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const candidates = [
  "node_modules/zxing-wasm/dist/reader/zxing_reader.wasm",
  "node_modules/zxing-wasm/dist/zxing_reader.wasm",
].map((p) => root + p);
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.error("Không tìm thấy zxing_reader.wasm trong node_modules/zxing-wasm; chạy pnpm install hoặc xem README của thư viện");
  process.exit(1);
}
copyFileSync(src, root + "public/zxing_reader.wasm");
console.log(`Đã chép ${src} -> ${root}public/zxing_reader.wasm`);
