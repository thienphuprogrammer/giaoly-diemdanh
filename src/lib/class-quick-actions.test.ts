import { describe, expect, it } from "vitest";
import { classQuickActions } from "./class-quick-actions";

const TODAY = "2026-10-12";

describe("classQuickActions", () => {
  it("a writer gets today's board and the scanner", () => {
    expect(classQuickActions({ classId: "c1", canWrite: true, today: TODAY })).toEqual([
      { key: "board", label: "Điểm danh hôm nay", href: "/lop/c1/diem-danh/2026-10-12", primary: true },
      { key: "scan", label: "Quét QR", href: "/lop/c1/diem-danh/2026-10-12/quet", primary: false },
    ]);
  });

  it("a read-only grade head gets today's board (view) and stats, never the scanner", () => {
    const actions = classQuickActions({ classId: "c1", canWrite: false, today: TODAY });
    expect(actions).toEqual([
      { key: "board", label: "Xem buổi hôm nay", href: "/lop/c1/diem-danh/2026-10-12", primary: false },
      { key: "stats", label: "Thống kê", href: "/lop/c1/thong-ke", primary: false },
    ]);
    expect(actions.some((a) => a.href.endsWith("/quet"))).toBe(false);
  });

  it("encodes the class id in the path", () => {
    const [board] = classQuickActions({ classId: "a/b", canWrite: true, today: TODAY });
    expect(board.href).toBe("/lop/a%2Fb/diem-danh/2026-10-12");
  });
});
