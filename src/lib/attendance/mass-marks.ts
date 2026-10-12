import type { Mark, Marks } from "./marks";
import type { AttendanceStatus } from "./warning";

/** Trạng thái của buổi đi lễ: không có "đi muộn". "Chưa hỏi" = không có dòng (null). */
export const MASS_STATUSES = ["present", "absent_excused", "absent_unexcused"] as const;
export type MassStatus = (typeof MASS_STATUSES)[number];
export interface MassMark { status: MassStatus; reason: string | null }

/** Dòng cũ `late` (nếu có, vd. ghi trước khi có ràng buộc) hiện là "có đi lễ": buổi đi lễ không bao giờ hiện "đi muộn". */
export const toMassStatus = (status: AttendanceStatus): MassStatus => (status === "late" ? "present" : status);

/** Dấu đi lễ cho từng em trong danh sách lớp (null = chưa hỏi); dòng của em không còn trong danh sách bị bỏ. */
export function massMarksFor(studentIds: readonly string[], server: Readonly<Record<string, MassMark>>): Marks {
  return Object.fromEntries(studentIds.map((id): [string, Mark] => [id, server[id] ?? null]));
}

/** Dòng tóm tắt khi phần đi lễ đang gập: số em có đi lễ / sĩ số, và số em chưa hỏi. */
export function massSummary(studentIds: readonly string[], marks: Marks): { went: number; unasked: number; total: number } {
  const of = (id: string) => marks[id]?.status ?? null;
  return {
    went: studentIds.filter((id) => of(id) === "present").length,
    unasked: studentIds.filter((id) => of(id) === null).length,
    total: studentIds.length,
  };
}

/** Bốn lựa chọn của mỗi em: nhãn ngắn trên nút (vừa 4 cột ở 375px) và nhãn đầy đủ cho trình đọc màn hình. */
export const MASS_CHOICES: readonly { value: MassStatus | null; short: string; label: string }[] = [
  { value: null, short: "Chưa hỏi", label: "Chưa hỏi" },
  { value: "present", short: "Có đi", label: "Có đi lễ" },
  { value: "absent_excused", short: "Có phép", label: "Không đi lễ có phép" },
  { value: "absent_unexcused", short: "Không phép", label: "Không đi lễ không phép" },
];
