import { createRateLimiter } from "@/lib/rate-limit";

/** Quét liên tục ≈ 1 lượt/giây; 180/phút còn dư chỗ cho gửi lại, hoàn tác và tìm tên. */
export const scanLimiter = createRateLimiter({ max: 180, windowMs: 60_000 });

/** Bảng tra nặng (cả lớp + số buổi vắng); màn quét chỉ tải lại khi mở/kết nối lại, nên 30/phút là thừa. */
export const rosterLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });
