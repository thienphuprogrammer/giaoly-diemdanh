import type { AttendanceStatus } from "./warning";

export type Mark = { status: AttendanceStatus; reason: string | null } | null;
export type Marks = Record<string, Mark>;

export function initialMarks(
  students: ReadonlyArray<{ id: string; status: AttendanceStatus | null; reason: string | null }>,
): Marks {
  return Object.fromEntries(students.map((s) => [s.id, s.status ? { status: s.status, reason: s.reason } : null]));
}

/** Điền "có mặt" cho các em chưa điểm danh, giữ nguyên các em đã có trạng thái. */
export function fillPresent(marks: Marks): Marks {
  return Object.fromEntries(
    Object.entries(marks).map(([id, mark]) => [id, mark ?? { status: "present" as const, reason: null }]),
  );
}

export const countMarked = (marks: Marks): number => Object.values(marks).filter(Boolean).length;

/** Đánh số thứ tự mỗi lần lưu theo từng key, để bỏ qua phản hồi cũ đến muộn. */
export function createSequencer() {
  const latest = new Map<string, number>();
  return {
    begin(key: string): number {
      const n = (latest.get(key) ?? 0) + 1;
      latest.set(key, n);
      return n;
    },
    isLatest: (key: string, n: number): boolean => latest.get(key) === n,
  };
}
