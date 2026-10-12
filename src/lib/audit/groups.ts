import type { AuditLogGroup } from "@/db/queries/audit";

/** Các "loại" của trang nhật ký: nhãn tiếng Việt + đoạn URL (tham số `loai`). `all` không có tham số. */
export const LOG_GROUPS: readonly { group: AuditLogGroup; slug: string; label: string }[] = [
  { group: "all", slug: "", label: "Tất cả" },
  { group: "attendance", slug: "diem-danh", label: "Điểm danh" },
  { group: "mass", slug: "di-le", label: "Đi lễ" },
  { group: "student", slug: "thieu-nhi", label: "Thiếu nhi" },
  { group: "seating", slug: "so-do", label: "Sơ đồ" },
  { group: "session", slug: "buoi-hoc", label: "Buổi học" },
  { group: "scan", slug: "quet-the", label: "Quét thẻ" },
];

export function groupFromSlug(slug: string | undefined): AuditLogGroup {
  return LOG_GROUPS.find((g) => g.slug !== "" && g.slug === slug)?.group ?? "all";
}

const slugOf = (group: AuditLogGroup) => LOG_GROUPS.find((g) => g.group === group)?.slug ?? "";

export interface LogParams { from?: string; to?: string; group?: AuditLogGroup; cursor?: string }

/** Địa chỉ trang nhật ký với bộ lọc (chỉ giữ tham số có giá trị, để đường dẫn chia sẻ được gọn). */
export function logHref(classId: string, p: LogParams = {}): string {
  const q = new URLSearchParams();
  if (p.from) q.set("tu", p.from);
  if (p.to) q.set("den", p.to);
  const slug = slugOf(p.group ?? "all");
  if (slug) q.set("loai", slug);
  if (p.cursor) q.set("sau", p.cursor);
  const qs = q.toString();
  return `/lop/${classId}/nhat-ky${qs ? `?${qs}` : ""}`;
}
