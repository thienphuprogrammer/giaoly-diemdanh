import globalSetup from "../e2e/global-setup";
import { errorSummary } from "../src/lib/error-summary";

/**
 * Nạp dữ liệu mẫu E2E vào E2E_DATABASE_URL để chạy `pnpm bench:scan` trên hạ tầng thật.
 * CẢNH BÁO: xóa sạch schema `public` và `drizzle` của database đó. globalSetup từ chối nếu tên database không chứa "e2e".
 */
globalSetup()
  .then(() => console.log("Đã nạp dữ liệu mẫu E2E."))
  .catch((e) => {
    console.error(errorSummary(e, ["Thiếu E2E_DATABASE_URL", "Tên database E2E phải chứa 'e2e' (tránh xóa nhầm DB thật)"]));
    process.exit(1);
  });
