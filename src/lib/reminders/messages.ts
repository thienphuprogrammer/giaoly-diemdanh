import type { PushMessage } from "@/lib/push/payload";

/**
 * Nội dung và khoá idempotent của thông báo nhắc việc (spec §4). Thông báo hiện trên màn hình khoá nên KHÔNG BAO GIỜ
 * có tên hay số điện thoại của em: chỉ tên lớp và số lượng.
 */
export type ReminderKind = "class_reminder" | "absence_threshold" | "mass_threshold" | "housekeeping";
export type ThresholdKind = Extract<ReminderKind, "absence_threshold" | "mass_threshold">;
/** Hai loại thông báo ngưỡng (định nghĩa duy nhất; dùng cho gửi và dọn nhật ký). */
export const THRESHOLD_KINDS: readonly ThresholdKind[] = ["absence_threshold", "mass_threshold"];

/** `notification_log.target_key` của nhắc điểm danh: một lần cho mỗi (lớp, ngày) mỗi GLV. */
export const classReminderKey = (classId: string, date: string): string => `${classId}:${date}`;
/** `notification_log.target_key` của thông báo ngưỡng: một lần cho mỗi (em, học kỳ) mỗi loại mỗi trưởng khối. */
export const thresholdKey = (studentId: string, termId: string): string => `${studentId}:${termId}`;

/** "Ấu 1A" -> "Lớp Ấu 1A"; tên đã bắt đầu bằng "Lớp" giữ nguyên. */
export const classLabel = (name: string): string => (/^lớp(?:\s|$)/iu.test(name.trim()) ? name.trim() : `Lớp ${name.trim()}`);

export function classReminderMessage(cls: { id: string; name: string }, date: string): PushMessage {
  return { title: "Chưa điểm danh", body: `${classLabel(cls.name)} chưa điểm danh hôm nay`, url: `/lop/${cls.id}/diem-danh/${date}` };
}

const WHAT: Record<ThresholdKind, { title: string; noun: string }> = {
  absence_threshold: { title: "Cảnh báo vắng học", noun: "vắng học" },
  mass_threshold: { title: "Cảnh báo vắng lễ", noun: "vắng lễ" },
};
const MAX_CLASS_NAMES = 4;

/**
 * Một thông báo gộp cho một trưởng khối trong một lần chạy: `classNames` có một phần tử cho MỖI em vừa chạm ngưỡng
 * (tên lớp của em), nên số em = độ dài; tên lớp được bỏ trùng, sắp theo tiếng Việt và rút gọn khi quá nhiều.
 */
export function thresholdMessage(kind: ThresholdKind, classNames: readonly string[]): PushMessage {
  const { title, noun } = WHAT[kind];
  const unique = [...new Set(classNames.map(classLabel))].sort((a, b) => a.localeCompare(b, "vi"));
  const shown = unique.length > MAX_CLASS_NAMES + 1
    ? `${unique.slice(0, MAX_CLASS_NAMES).join(", ")} và ${unique.length - MAX_CLASS_NAMES} lớp khác`
    : unique.join(", ");
  const count = classNames.length;
  const body = count === 1 && unique.length === 1
    ? `Có 1 em đạt ngưỡng cảnh báo ${noun} (${shown})`
    : `Có ${count} em đạt ngưỡng cảnh báo ${noun} ở ${shown}`;
  return { title, body, url: "/can-chu-y" };
}
