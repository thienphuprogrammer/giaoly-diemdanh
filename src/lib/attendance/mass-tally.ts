/** Ngưỡng cảnh báo đi lễ trưởng khối được chọn (số tuần không đi lễ trong học kỳ). */
export const MASS_THRESHOLD_MIN = 1;
export const MASS_THRESHOLD_MAX = 20;

/** Một tuần đi lễ "đã ghi nhận" của lớp (buổi `mass` chưa huỷ, có ít nhất một dòng điểm danh). */
export interface MassWeek {
  sessionId: string;
  heldOn: string;
}

/** attended = có dòng có đi lễ; missed = tuần được tính mà không có; not_counted = trước khi em xuất hiện lần đầu. */
export type MassCell = "attended" | "missed" | "not_counted";

export interface MassTally {
  counted: number;
  attended: number;
  missed: number;
  /** Cùng thứ tự với `weeks`. */
  cells: MassCell[];
}

/**
 * Định nghĩa spec §1b cộng với heuristic em vào lớp giữa kỳ: bảng `students` không có ngày nhập học, nên chỉ tính các
 * tuần từ ngày em có dòng điểm danh ĐẦU TIÊN ở lớp (`firstSeen`, buổi học hoặc đi lễ, mọi trạng thái, mọi học kỳ).
 * Em chưa từng được ghi dòng nào (`firstSeen` null) thì không tính tuần nào.
 */
export function tallyMass(weeks: readonly MassWeek[], firstSeen: string | null, attendedSessionIds: ReadonlySet<string>): MassTally {
  const cells = weeks.map((w): MassCell => {
    if (firstSeen === null || w.heldOn < firstSeen) return "not_counted";
    return attendedSessionIds.has(w.sessionId) ? "attended" : "missed";
  });
  const attended = cells.filter((c) => c === "attended").length;
  const missed = cells.filter((c) => c === "missed").length;
  return { counted: attended + missed, attended, missed, cells };
}

/** Cảnh báo khi số tuần không đi lễ chạm ngưỡng của khối (bằng ngưỡng là cảnh báo). */
export const isMassWarning = (missed: number, threshold: number): boolean => missed >= threshold;
