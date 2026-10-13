import type { Marks } from "./marks";
import { unmarkedStudents } from "./remaining-absent";
import { filterRoster } from "./roster-search";

export type AttendanceRosterFilter = "all" | "unmarked";

/** Chỉ lọc phần hiển thị; các thao tác cả lớp luôn dùng danh sách gốc. */
export function filterAttendanceRoster<T extends { id: string; fullName: string; saintName: string | null }>(
  students: readonly T[],
  marks: Marks,
  query: string,
  filter: AttendanceRosterFilter,
): T[] {
  const candidates = filter === "unmarked" ? unmarkedStudents(students, marks) : [...students];
  return query.trim() ? filterRoster(candidates, query, candidates.length) : candidates;
}
