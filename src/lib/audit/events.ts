/**
 * Nhật ký thay đổi (spec §2): bảng hành động được phép và bộ lọc `summary`. Hàm thuần, không đụng cơ sở dữ liệu.
 * `summary` chỉ chứa trước/sau của trạng thái, lý do, tên em, số lượng — không bao giờ có `qr_token`, payload thẻ
 * hay SĐT đầy đủ (chỉ dạng đã che của `maskPhone`).
 */

export const AUDIT_ENTITIES = ["attendance", "student", "seating_plan", "session", "grade_settings"] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Mỗi hành động thuộc đúng một loại đối tượng; `recordAudit` từ chối cặp sai. */
export const AUDIT_ACTIONS = {
  "attendance.set": "attendance",
  "attendance.bulk_present": "attendance",
  "attendance.bulk_undo": "attendance",
  "attendance.remaining_absent": "attendance",
  "student.create": "student",
  "student.update": "student",
  "student.deactivate": "student",
  "student.reactivate": "student",
  "student.import": "student",
  "student.contact_update": "student",
  "student.qr_rotate": "student",
  "seating.create": "seating_plan",
  "seating.apply_template": "seating_plan",
  "seating.save_layout": "seating_plan",
  "seating.activate": "seating_plan",
  "seating.delete": "seating_plan",
  "session.cancel": "session",
  "session.reopen": "session",
  "grade.mass_threshold": "grade_settings",
} as const satisfies Record<string, AuditEntity>;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const isAuditAction = (name: string): name is AuditAction => Object.hasOwn(AUDIT_ACTIONS, name);
export const entityOf = (action: AuditAction): AuditEntity => AUDIT_ACTIONS[action];

export type AuditPrimitive = string | number | boolean | null;
export type AuditValue = AuditPrimitive | AuditPrimitive[] | { [key: string]: AuditPrimitive | AuditPrimitive[] };
export type AuditSummary = { [key: string]: AuditValue };

export const AUDIT_SUMMARY_MAX_BYTES = 2048;

/** Lỗi lập trình (người gọi là code của chính ứng dụng): không bao giờ chứa giá trị vi phạm. */
export class AuditSummaryError extends Error {
  constructor(reason: string) {
    super(`audit summary rejected: ${reason}`);
    this.name = "AuditSummaryError";
  }
}

const MASK = "••••••";
const CARD_PAYLOAD = /dd1\.[0-9a-f]{32}/i;
const HEX_TOKEN = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i;
/**
 * SĐT Việt Nam: 0 / 84 / +84 rồi đủ chữ số (10 hoặc 11 chữ số kể cả đầu số 0; 84 + 9 số, có thể "(0)" sau 84), xen tối đa
 * 2 ký tự ngăn cách (khoảng trắng . - – — / ngoặc) giữa hai chữ số, có thể dính tiền tố chữ ASCII ("sdt0901…").
 * - Số phải có hình dạng SĐT (đủ 10-11 chữ số) nên mã ngắn ("mã HS 00012345") và đếm không bị che.
 * - Loại bỏ ngày DD-MM-YYYY / DD.MM.YYYY / DD MM YYYY ngay tại đầu số; ngày ISO (2026-10-12) bị chặn bởi lookbehind.
 * - Trước tiền tố/đầu số không được có chữ hoặc số; gạch ngang chỉ bị loại khi đứng sau một ký tự hex ("…e-0901…" của UUID),
 *   nên "sdt-0901234567" hay "mẹ-0901234567" vẫn bị che. Mỗi vòng lặp đều tiêu thụ một chữ số và bị chặn số lần: không backtrack bùng nổ.
 */
const SEP = String.raw`[\s.\-–—/()]`;
const PHONE_LIKE = new RegExp(
  String.raw`(?<![0-9A-Za-z])(?<![0-9a-f]-)(?:[A-Za-z]{1,10})?` +
  String.raw`(?!\d{1,2}[\s.\-–/]\d{1,2}[\s.\-–/](?:19|20)\d{2}(?!\d))` +
  String.raw`(?:\+?84(?:[\s.\-–—/]{0,2}\(0\))?(?:${SEP}{0,2}\d){9}|(?:\(\s?)?0(?:${SEP}{0,2}\d){9,10})` +
  String.raw`(?![0-9A-Za-z])(?!-[0-9a-f])`,
);
const MASKED_PHONE = /^•+\d{0,3}$/;

/** Che SĐT: chỉ giữ 3 số cuối, độ dài cố định để không lộ độ dài số. */
export function maskPhone(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const digits = raw.replace(/\D/g, "");
  return `${MASK}${digits.length >= 3 ? digits.slice(-3) : ""}`;
}

const global = (re: RegExp) => new RegExp(re.source, `${re.flags}g`);

/** Văn bản tự do (lý do, tên) trước khi vào nhật ký: ẩn payload/mã thẻ, che dãy số giống SĐT. */
export function redactText(text: string): string {
  return text
    .replace(global(CARD_PAYLOAD), "[ẩn]")
    .replace(global(HEX_TOKEN), "[ẩn]")
    .replace(global(PHONE_LIKE), (m) => maskPhone(m) ?? MASK);
}

const normKey = (key: string) => key.toLowerCase().replace(/[^a-z]/g, "");
const isForbiddenKey = (key: string) => {
  const k = normKey(key);
  return k.includes("token") || k.includes("password") || k.includes("payload") || k.includes("secret");
};
const isPhoneKey = (key: string) => normKey(key).includes("phone");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function checkPrimitive(key: string, v: unknown): AuditPrimitive {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new AuditSummaryError(`non-finite number at "${key}"`);
    return v;
  }
  if (typeof v !== "string") throw new AuditSummaryError(`unsupported value type at "${key}"`);
  if (CARD_PAYLOAD.test(v) || HEX_TOKEN.test(v)) throw new AuditSummaryError(`card token at "${key}"`);
  if (isPhoneKey(key)) {
    if (!MASKED_PHONE.test(v)) throw new AuditSummaryError(`unmasked phone at "${key}"`);
  } else if (PHONE_LIKE.test(v)) {
    throw new AuditSummaryError(`phone-like digits at "${key}"`);
  }
  return v;
}

/** Giá trị lá: nguyên thuỷ hoặc mảng nguyên thuỷ. */
function checkLeaf(key: string, v: unknown): AuditPrimitive | AuditPrimitive[] {
  if (isForbiddenKey(key)) throw new AuditSummaryError(`forbidden key "${key}"`);
  return Array.isArray(v) ? v.map((item) => checkPrimitive(key, item)) : checkPrimitive(key, v);
}

/** Giá trị cấp một: lá, hoặc đúng một tầng object lồng (ví dụ `before`/`after`) chỉ chứa lá. */
function checkValue(key: string, v: unknown): AuditValue {
  if (!isPlainObject(v)) return checkLeaf(key, v);
  if (isForbiddenKey(key)) throw new AuditSummaryError(`forbidden key "${key}"`);
  return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, checkLeaf(k, item)]));
}

/**
 * Kiểm tra và sao chép `summary`: object thuần gồm giá trị nguyên thuỷ, mảng giá trị nguyên thuỷ hoặc một tầng object
 * lồng (`before`/`after`); ≤ 2KB UTF-8. Ném `AuditSummaryError` khi có khoá cấm (token/payload/password), mã/payload thẻ,
 * SĐT chưa che. Ném thay vì lặng lẽ bỏ khoá: người gọi là code của ứng dụng, sai là lỗi lập trình cần thấy ngay.
 */
export function sanitizeSummary(summary: unknown): AuditSummary {
  if (!isPlainObject(summary)) throw new AuditSummaryError("summary must be a plain object");
  const out: AuditSummary = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, checkValue(k, v)]));
  if (new TextEncoder().encode(JSON.stringify(out)).length > AUDIT_SUMMARY_MAX_BYTES) {
    throw new AuditSummaryError(`summary larger than ${AUDIT_SUMMARY_MAX_BYTES} bytes`);
  }
  return out;
}
