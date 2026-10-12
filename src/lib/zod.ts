import { z } from "zod";

/**
 * Điểm import zod cho code chạy được ở trình duyệt (src/lib dùng chung server/client).
 * Zod 4 dò JIT bằng `Function("")`; CSP không có 'unsafe-eval' nên trình duyệt báo vi phạm (đã bắt gặp ở bản
 * production: bảng điểm danh, danh sách thiếu nhi, sơ đồ). Tắt JIT chỉ trong trình duyệt; server giữ JIT cho nhanh.
 */
if (typeof window !== "undefined") z.config({ jitless: true });

export { z };
