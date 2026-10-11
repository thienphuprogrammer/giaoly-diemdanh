const PREFIX = "dd1.";
const TOKEN_RE = /^[0-9a-f]{32}$/;

export function formatQrPayload(token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error("Mã thẻ không hợp lệ");
  return PREFIX + token;
}

/** Trả token nếu chuỗi đúng định dạng `dd1.<32 hex thường>`, ngược lại null. Không bao giờ coi chuỗi là URL. */
export function parseQrPayload(text: string): string | null {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) return null;
  const token = t.slice(PREFIX.length);
  return TOKEN_RE.test(token) ? token : null;
}
