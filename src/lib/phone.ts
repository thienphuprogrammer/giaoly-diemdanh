/** Chuẩn hoá số điện thoại Việt Nam. Hàm thuần, dùng chung cho form, dịch vụ và trang hồ sơ. */

export type PhoneResult = { ok: true; value: string } | { ok: false; error: string };

const ALLOWED = /^[0-9+\s.()-]+$/;
const NATIONAL = /^0[1-9]\d{8,9}$/;
export const PHONE_ERROR = "SĐT không hợp lệ";

/** Trả số dạng trong nước ("0901234567"): bỏ khoảng trắng/dấu chấm/gạch/ngoặc, đổi +84/84/0084 về 0. */
export function normalizePhone(raw: string): PhoneResult {
  const input = raw.trim();
  if (!input || !ALLOWED.test(input)) return { ok: false, error: PHONE_ERROR };
  const compact = input.replace(/[\s.()-]/g, "");
  if (compact.indexOf("+") > 0 || compact.lastIndexOf("+") > 0) return { ok: false, error: PHONE_ERROR };
  let national: string;
  if (compact.startsWith("+")) {
    if (!compact.startsWith("+84")) return { ok: false, error: PHONE_ERROR };
    national = `0${compact.slice(3).replace(/^0/, "")}`;
  } else if (compact.startsWith("0084")) {
    national = `0${compact.slice(4).replace(/^0/, "")}`;
  } else if (compact.startsWith("84") && compact.length >= 11) {
    national = `0${compact.slice(2).replace(/^0/, "")}`;
  } else {
    national = compact;
  }
  return NATIONAL.test(national) ? { ok: true, value: national } : { ok: false, error: PHONE_ERROR };
}

/** "84901234567" (không dấu +) cho liên kết Zalo; null nếu số không hợp lệ. */
export function toInternationalDigits(raw: string): string | null {
  const r = normalizePhone(raw);
  return r.ok ? `84${r.value.slice(1)}` : null;
}

export interface PhoneLinks {
  display: string;
  tel: string;
  sms: string;
  zalo: string;
}

/** Liên kết liên hệ cho một số; null khi chưa có số hoặc số lưu từ trước không hợp lệ. */
export function phoneLinks(raw: string | null | undefined): PhoneLinks | null {
  if (!raw) return null;
  const r = normalizePhone(raw);
  if (!r.ok) return null;
  return { display: r.value, tel: `tel:${r.value}`, sms: `sms:${r.value}`, zalo: `https://zalo.me/84${r.value.slice(1)}` };
}
