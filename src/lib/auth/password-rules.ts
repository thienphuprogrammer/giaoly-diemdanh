/** Quy tắc mật khẩu dùng chung cho server và form (thuần, không kéo bcrypt vào bundle client). */
export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt bỏ qua mọi byte sau byte thứ 72, nên giới hạn theo byte UTF-8 (chữ có dấu chiếm 2–3 byte). */
export const PASSWORD_MAX_BYTES = 72;

export const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;
