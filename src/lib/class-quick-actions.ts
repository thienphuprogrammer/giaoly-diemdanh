export interface ClassQuickAction {
  key: "board" | "scan" | "stats";
  label: string;
  href: string;
  primary: boolean;
}

/**
 * Nút nhanh trên thẻ lớp ở trang chủ. Người có quyền ghi: điểm danh hôm nay + quét QR.
 * Người chỉ đọc (trưởng khối không được gán lớp): xem buổi hôm nay + thống kê; không bao giờ có máy quét.
 */
export function classQuickActions({ classId, canWrite, today }: { classId: string; canWrite: boolean; today: string }): ClassQuickAction[] {
  const base = `/lop/${encodeURIComponent(classId)}`;
  const board = `${base}/diem-danh/${today}`;
  if (canWrite) {
    return [
      { key: "board", label: "Điểm danh hôm nay", href: board, primary: true },
      { key: "scan", label: "Quét QR", href: `${board}/quet`, primary: false },
    ];
  }
  return [
    { key: "board", label: "Xem buổi hôm nay", href: board, primary: false },
    { key: "stats", label: "Thống kê", href: `${base}/thong-ke`, primary: false },
  ];
}
