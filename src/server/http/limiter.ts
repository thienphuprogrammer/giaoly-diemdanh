import { createRateLimiter } from "@/lib/rate-limit";

/** Quét liên tục ≈ 1 lượt/giây; 180/phút còn dư chỗ cho gửi lại, hoàn tác và tìm tên. */
export const scanLimiter = createRateLimiter({ max: 180, windowMs: 60_000 });

/** Bảng tra nặng (cả lớp + số buổi vắng); màn quét chỉ tải lại khi mở/kết nối lại, nên 30/phút là thừa. */
export const rosterLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

/** Bật/tắt thông báo và đồng bộ lặng lẽ khi mở trang Tài khoản: 20/phút/người là thừa cho dùng thật. */
export const pushSubscribeLimiter = createRateLimiter({ max: 20, windowMs: 60_000 });

/** "Gửi thử" thông báo: mỗi lần là một lượt gửi ra dịch vụ push bên ngoài. */
export const pushTestLimiter = createRateLimiter({ max: 3, windowMs: 60_000 });

/** Đổi mật khẩu: mỗi lần là một (hai) lượt bcrypt; 10/phút/người là thừa, chặn spam trước cả khi chạm khóa 5 lượt sai. */
export const passwordChangeLimiter = createRateLimiter({ max: 10, windowMs: 60_000 });
