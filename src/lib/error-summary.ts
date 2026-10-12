/** Thông điệp chung khi không có mã lỗi an toàn để in. */
export const GENERIC_FAILURE = "Thất bại (không in chi tiết lỗi để tránh lộ cấu hình; kiểm tra biến môi trường và kết nối).";

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Tóm tắt lỗi để in ra từ script (benchmark…): chỉ in `code` (vd. ECONNREFUSED, 28P01) hoặc thông điệp chung.
 * Thông điệp gốc của driver có thể chứa host/tên người dùng/chuỗi kết nối nên không bao giờ in.
 * `known`: các thông điệp do chính script đặt ra (an toàn để in nguyên văn).
 */
export function errorSummary(e: unknown, known: readonly string[] = []): string {
  if (e instanceof Error && known.includes(e.message)) return e.message;
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && SAFE_CODE.test(code) ? `Lỗi: ${code}` : GENERIC_FAILURE;
}
