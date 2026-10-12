/**
 * Dòng chữ tiếng Việt cho nhật ký (spec §2). Hàm thuần, chịu được `summary` thiếu/sai dạng (dòng cũ hoặc từ phiên bản khác):
 * không ném lỗi, không bao giờ in JSON thô hay khoá lạ, và chạy lại `redactText` cho mọi chuỗi tự do (phòng dòng cũ lỡ lưu
 * SĐT/mã thẻ chưa che). Việc thoát ký tự do React (không dùng `dangerouslySetInnerHTML`).
 */
import { shortDate } from "@/lib/date-label";
import { redactText } from "./events";

export const DELETED_ACTOR = "Tài khoản đã xoá";
const MAX_TEXT = 120;

export interface Description {
  actor: string;
  /** Phần còn lại sau tên người làm. */
  what: string;
  /** Cả câu: `actor + " " + what`. */
  text: string;
}

const STATUS_LABEL: Record<string, string> = {
  present: "Có mặt", late: "Đi muộn", absent_excused: "Vắng có phép", absent_unexcused: "Vắng không phép",
};
const UNMARKED = "chưa điểm danh";
const FIELD_LABEL: Record<string, string> = {
  fullName: "tên", saintName: "tên thánh", birthDate: "ngày sinh", parentPhone: "SĐT phụ huynh", note: "ghi chú",
};

type Bag = Record<string, unknown>;
const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);
const safe = (s: string) => redactText(s.trim()).slice(0, MAX_TEXT);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? safe(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isMass = (s: Bag) => s.sessionKind === "mass";

/** "2026-10-12" -> "12/10"; null khi không phải ngày thật. */
function dayMonth(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const full = shortDate(v);
  return full === v ? null : full.slice(0, 5);
}

/** "(buổi 12/10)" / "(đi lễ 11/10)" hoặc chuỗi rỗng. */
function sessionSuffix(kind: unknown, date: unknown): string {
  const d = dayMonth(date);
  if (d === null) return "";
  return ` (${kind === "mass" ? "đi lễ" : "buổi"} ${d})`;
}

const statusLabel = (v: unknown): string | null => (typeof v === "string" ? (STATUS_LABEL[v] ?? null) : null);

/** `{status, reason}` hợp lệ -> nhãn kèm lý do; null nếu không hợp lệ. */
function markLabel(v: unknown): string | null {
  if (!isBag(v)) return null;
  const label = statusLabel(v.status);
  if (label === null) return null;
  const reason = str(v.reason);
  return reason ? `${label}, lý do: ${reason}` : label;
}

function describeAttendanceSet(s: Bag): string {
  const name = str(s.studentName) ?? "một em";
  const before = markLabel(s.before);
  const after = markLabel(s.after);
  const suffix = sessionSuffix(s.sessionKind, s.sessionDate);
  if (before !== null && after !== null) return `đổi ${name}: ${before} → ${after}${suffix}`;
  if (after !== null) return `${isMass(s) ? "ghi đi lễ cho" : "điểm danh"} ${name}: ${after}${suffix}`;
  if (before !== null && s.after === null) return `xoá điểm danh của ${name}, trước đó: ${before}${suffix}`;
  return `điểm danh ${name}: (không rõ trạng thái)${suffix}`;
}

function bulk(s: Bag, head: string): string {
  const count = num(s.count);
  return `${head}${count === null ? "" : `: ${count} em`}${sessionSuffix(s.sessionKind, s.sessionDate)}`;
}

const shown = (v: unknown): string => (v === null || v === undefined ? "chưa có" : (str(v) ?? "(trống)"));

function changedFields(s: Bag): string {
  const keys = Array.isArray(s.changed) ? s.changed.filter((k): k is string => typeof k === "string" && k in FIELD_LABEL) : [];
  const before = isBag(s.before) ? s.before : {};
  const after = isBag(s.after) ? s.after : {};
  return keys
    .map((k) => (k in before || k in after ? `${FIELD_LABEL[k]} (${shown(before[k])} → ${shown(after[k])})` : FIELD_LABEL[k]))
    .join(", ");
}

function describeStudentChange(s: Bag, head: string): string {
  const fields = changedFields(s);
  return `${head} của ${str(s.studentName) ?? "một em"}${fields ? `: ${fields}` : ""}`;
}

const plan = (s: Bag) => { const n = str(s.planName); return n ? `sơ đồ "${n}"` : "một sơ đồ"; };

function describeSession(s: Bag, verb: "cancel" | "reopen"): string {
  const d = dayMonth(s.sessionDate);
  const mass = isMass(s);
  if (verb === "cancel") {
    if (mass) return d ? `đánh dấu nghỉ đi lễ ${d}` : "đánh dấu nghỉ một buổi đi lễ";
    return d ? `đánh dấu nghỉ lễ buổi học ${d}` : "đánh dấu nghỉ lễ một buổi học";
  }
  if (mass) return d ? `mở lại đi lễ ${d}` : "mở lại một buổi đi lễ";
  return d ? `mở lại buổi học ${d}` : "mở lại một buổi học";
}

function describeThreshold(s: Bag): string {
  const grade = str(s.gradeName);
  const [b, a] = [num(s.before), num(s.after)];
  return `đổi ngưỡng cảnh báo đi lễ${grade ? ` của ${grade}` : ""}${b !== null && a !== null ? `: ${b} → ${a} lần vắng` : ""}`;
}

function describeNextGrade(s: Bag): string {
  const grade = str(s.gradeName);
  const head = `đặt khối kế tiếp${grade ? ` của ${grade}` : ""}`;
  if (!("before" in s) && !("after" in s)) return head;
  const label = (v: unknown) => str(v) ?? "chưa có";
  return `${head}: ${label(s.before)} → ${label(s.after)}`;
}

function describeSchoolYear(s: Bag): string {
  const name = str(s.yearName);
  if (!name) return "tạo năm học mới";
  const [from, to] = [s.term1Start, s.term2End].map((v) => { const d = typeof v === "string" ? shortDate(v) : null; return d && d !== v ? d : null; });
  return `tạo năm học ${name}${from && to ? ` (${from} – ${to})` : ""}`;
}

function describePromotion(s: Bag): string {
  const [from, to, count] = [str(s.fromClass), str(s.toClass), num(s.count)];
  if (!from || !to || count === null) return "chuyển em sang lớp khác";
  const seats = num(s.seatsRemoved);
  const skipped = num(s.skipped);
  const notes = [seats ? `bỏ ${seats} chỗ ngồi ở lớp cũ` : null, skipped ? `${skipped} em đã ở lớp mới` : null].filter((n) => n !== null);
  return `chuyển ${count} em từ ${from} sang ${to}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

function describePromotionUndo(s: Bag): string {
  const [from, to, restored] = [str(s.fromClass), str(s.toClass), num(s.restored)];
  if (!from || !to || restored === null) return "hoàn tác một lượt lên lớp";
  const missing = num(s.notRestored);
  return `hoàn tác lên lớp ${from} → ${to}: trả ${restored} em về lớp cũ${missing ? `, ${missing} em không trả được` : ""}`;
}

function describeImport(s: Bag): string {
  const count = num(s.count);
  const skipped = num(s.skipped);
  const head = count === null ? "nhập em từ tệp" : `nhập ${count} em từ tệp`;
  return skipped && skipped > 0 ? `${head} (bỏ qua ${skipped} dòng trùng)` : head;
}

function describeLayout(s: Bag): string {
  const [kept, removed] = [num(s.seatsKept), num(s.seatsRemoved)];
  const parts = [kept === null ? null : `giữ ${kept} chỗ`, removed ? `bỏ ${removed} chỗ` : null].filter((p) => p !== null);
  return `lưu bố cục ${plan(s)}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function what(action: string, s: Bag): string {
  const name = str(s.studentName) ?? "một em";
  switch (action) {
    case "attendance.set": return describeAttendanceSet(s);
    case "attendance.bulk_present": return bulk(s, `bấm "${isMass(s) ? "Cả lớp đi lễ" : "Tất cả có mặt"}"`);
    case "attendance.bulk_undo": return bulk(s, `hoàn tác "${isMass(s) ? "Cả lớp đi lễ" : "Tất cả có mặt"}"`);
    case "attendance.remaining_absent": return bulk(s, "đánh vắng không phép các em còn lại");
    case "student.create": return `thêm ${str(s.studentName) ? `em ${name}` : name}`;
    case "student.update": return describeStudentChange(s, "sửa thông tin");
    case "student.contact_update": return describeStudentChange(s, "cập nhật liên hệ");
    case "student.deactivate": return `cho ${name} nghỉ học (ẩn khỏi danh sách)`;
    case "student.reactivate": return `cho ${name} học lại (hiện lại trong danh sách)`;
    case "student.import": return describeImport(s);
    case "student.qr_rotate": return `đổi thẻ QR của ${name}`;
    case "seating.create": return `tạo ${plan(s)}`;
    case "seating.apply_template": return `áp dụng mẫu cho ${plan(s)}`;
    case "seating.save_layout": return describeLayout(s);
    case "seating.activate": return `đặt ${plan(s)} làm sơ đồ đang dùng`;
    case "seating.delete": return `xoá ${plan(s)}`;
    case "session.cancel": return describeSession(s, "cancel");
    case "session.reopen": return describeSession(s, "reopen");
    case "grade.mass_threshold": return describeThreshold(s);
    case "grade.next_grade": return describeNextGrade(s);
    case "school_year.create": return describeSchoolYear(s);
    case "promotion.apply": return describePromotion(s);
    case "promotion.undo": return describePromotionUndo(s);
    default: return /^[a-z_]{1,32}\.[a-z_]{1,32}$/.test(action) ? `thực hiện một thay đổi (${action})` : "thực hiện một thay đổi";
  }
}

const compose = (actorName: string | null | undefined, rest: string): Description => {
  const actor = str(actorName) ?? DELETED_ACTOR;
  return { actor, what: rest, text: `${actor} ${rest}` };
};

/** Dòng nhật ký thay đổi: tên người làm + việc đã làm (hành động lạ/cũ -> câu chung). */
export function describeAuditEvent(event: { action: string; actorName: string | null; summary: unknown }): Description {
  const summary = isBag(event.summary) ? event.summary : {};
  return compose(event.actorName, what(event.action, summary));
}

export interface ScanLine {
  actorName: string | null;
  kind: string;
  mode: string | null;
  studentName: string | null;
  prevStatus: string | null;
  newStatus: string | null;
  sessionDate: string;
  sessionKind: string;
}

/** Dòng "quét thẻ" lấy từ `attendance_scans` (chỉ lượt đã áp dụng). */
export function describeScanEvent(scan: ScanLine): Description {
  const name = str(scan.studentName) ?? "một em";
  const mode = statusLabel(scan.mode);
  const modeText = mode ? ` (chế độ ${mode})` : "";
  const change = `${statusLabel(scan.prevStatus) ?? UNMARKED} → ${statusLabel(scan.newStatus) ?? UNMARKED}`;
  const suffix = sessionSuffix(scan.sessionKind, scan.sessionDate);
  const head = scan.kind === "undo"
    ? `hoàn tác lượt quét của ${name}`
    : scan.kind === "manual" ? `chọn tên ${name} ở màn quét thẻ${modeText}` : `quét thẻ ${name}${modeText}`;
  return compose(scan.actorName, `${head}: ${change}${suffix}`);
}
