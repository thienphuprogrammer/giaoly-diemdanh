import type { Mark, Marks } from "./marks";

/** Một lần lưu thất bại (lượt mới nhất của em đó): giữ dấu muốn lưu để "Thử lại". */
export interface SaveFailure {
  studentId: string;
  mark: Mark;
  message: string;
}

/**
 * Trạng thái bảng điểm danh phía client.
 * - `marks`: những gì đang hiện (gồm cả chạm lạc quan chưa lưu xong).
 * - `confirmed`: giá trị máy chủ đã xác nhận, dùng để trả về khi lưu lỗi.
 * - `inFlight`/`latest`: số lần lưu đang bay và số thứ tự lượt mới nhất của từng em.
 * - `touched`: các em được chạm kể từ lần yêu cầu dữ liệu mới gần nhất — bản từ máy chủ có thể
 *   được đọc trước khi lượt đó lưu xong, nên khi gộp phải giữ giá trị cục bộ của các em này.
 */
export interface BoardState {
  marks: Marks;
  confirmed: Marks;
  inFlight: Readonly<Record<string, number>>;
  latest: Readonly<Record<string, number>>;
  failures: readonly SaveFailure[];
  touched: readonly string[];
  savedCount: number;
}

export type BoardAction =
  | { type: "begin"; studentId: string; next: Mark; turn: number }
  | { type: "settle"; studentId: string; next: Mark; turn: number; ok: boolean; message?: string }
  /** Quá hạn chờ: trả về như cũ và báo lỗi, nhưng lượt vẫn tính là đang lưu cho tới khi có kết quả thật. */
  | { type: "timeout"; studentId: string; next: Mark; turn: number; message: string }
  /** Kết quả thật của một lượt đã quá hạn. */
  | { type: "late"; studentId: string; next: Mark; turn: number; ok: boolean }
  | { type: "dismiss"; studentId: string }
  | { type: "syncRequested" }
  | { type: "fresh"; server: Marks }
  | { type: "bulkSet"; studentIds: readonly string[]; mark: Mark };

export type SaveChip = { kind: "saving"; count: number } | { kind: "saved" } | { kind: "idle" };

export function initBoardState(server: Marks): BoardState {
  return { marks: server, confirmed: server, inFlight: {}, latest: {}, failures: [], touched: [], savedCount: 0 };
}

/** Lấy dữ liệu máy chủ, trừ các em trong `keep` (giữ giá trị cục bộ). Em không còn trên máy chủ bị bỏ. */
export function mergeFresh(server: Marks, local: Marks, keep: ReadonlySet<string>): Marks {
  return Object.fromEntries(
    Object.entries(server).map(([id, mark]) => [id, keep.has(id) && id in local ? local[id] : mark]),
  );
}

const withoutKey = <T>(rec: Readonly<Record<string, T>>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

const dropFailure = (failures: readonly SaveFailure[], studentId: string) => failures.filter((f) => f.studentId !== studentId);

function decrement(inFlight: Readonly<Record<string, number>>, studentId: string): Record<string, number> {
  const n = (inFlight[studentId] ?? 0) - 1;
  return n > 0 ? { ...inFlight, [studentId]: n } : withoutKey(inFlight, studentId);
}

/** Lượt mới nhất của em bị lỗi/quá hạn: trả về giá trị đã xác nhận và ghi lỗi kèm dấu muốn lưu. */
function revert(state: BoardState, studentId: string, next: Mark, turn: number, message: string): BoardState {
  if (state.latest[studentId] !== turn) return state;
  return {
    ...state,
    marks: { ...state.marks, [studentId]: state.confirmed[studentId] ?? null },
    failures: [...dropFailure(state.failures, studentId), { studentId, mark: next, message }],
  };
}

function settle(state: BoardState, a: Extract<BoardAction, { type: "settle" }>): BoardState {
  const inFlight = decrement(state.inFlight, a.studentId);
  // Server Action chạy tuần tự: mọi lần lưu thành công (kể cả phản hồi cũ) là trạng thái máy chủ lúc đó.
  if (a.ok) return { ...state, inFlight, confirmed: { ...state.confirmed, [a.studentId]: a.next }, savedCount: state.savedCount + 1 };
  return revert({ ...state, inFlight }, a.studentId, a.next, a.turn, a.message ?? "");
}

function late(state: BoardState, a: Extract<BoardAction, { type: "late" }>): BoardState {
  const inFlight = decrement(state.inFlight, a.studentId);
  if (!a.ok) return { ...state, inFlight };
  const confirmed = { ...state.confirmed, [a.studentId]: a.next };
  const base = { ...state, inFlight, confirmed, savedCount: state.savedCount + 1 };
  if (state.latest[a.studentId] !== a.turn) return base;
  return { ...base, marks: { ...state.marks, [a.studentId]: a.next }, failures: dropFailure(state.failures, a.studentId) };
}

function bulkSet(state: BoardState, ids: readonly string[], mark: Mark): BoardState {
  const known = ids.filter((id) => id in state.marks);
  const confirmed = { ...state.confirmed, ...Object.fromEntries(known.map((id) => [id, mark])) };
  // Em đang có lượt chạm chờ lưu: lượt chạm đó mới hơn, giữ trên màn hình.
  const shown = known.filter((id) => !state.inFlight[id]);
  return { ...state, confirmed, marks: { ...state.marks, ...Object.fromEntries(shown.map((id) => [id, mark])) }, savedCount: state.savedCount + 1 };
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "begin":
      return {
        ...state,
        marks: { ...state.marks, [action.studentId]: action.next },
        inFlight: { ...state.inFlight, [action.studentId]: (state.inFlight[action.studentId] ?? 0) + 1 },
        latest: { ...state.latest, [action.studentId]: action.turn },
        failures: dropFailure(state.failures, action.studentId),
        touched: state.touched.includes(action.studentId) ? state.touched : [...state.touched, action.studentId],
      };
    case "settle":
      return settle(state, action);
    case "timeout":
      return revert(state, action.studentId, action.next, action.turn, action.message);
    case "late":
      return late(state, action);
    case "dismiss":
      return { ...state, failures: dropFailure(state.failures, action.studentId) };
    case "syncRequested":
      return { ...state, touched: Object.keys(state.inFlight) };
    case "fresh": {
      const keep = new Set([...state.touched, ...Object.keys(state.inFlight)]);
      return { ...state, marks: mergeFresh(action.server, state.marks, keep), confirmed: mergeFresh(action.server, state.confirmed, keep) };
    }
    case "bulkSet":
      return bulkSet(state, action.studentIds, action.mark);
  }
}

export const pendingCount = (state: BoardState): number => Object.values(state.inFlight).reduce((n, k) => n + k, 0);

/** Chip trạng thái lưu: đang lưu (kể cả `extraPending` như thao tác hàng loạt) / đã lưu / chưa có gì. */
export function saveChip(state: BoardState, extraPending = 0): SaveChip {
  return saveChipOf([state], extraPending);
}

/** Như `saveChip` cho một bảng có nhiều hàng đợi lưu (điểm danh buổi học + đi lễ): một chip chung. */
export function saveChipOf(states: readonly BoardState[], extraPending = 0): SaveChip {
  const count = states.reduce((n, s) => n + pendingCount(s), extraPending);
  if (count > 0) return { kind: "saving", count };
  const saved = states.some((s) => s.savedCount > 0);
  if (saved && states.every((s) => s.failures.length === 0)) return { kind: "saved" };
  return { kind: "idle" };
}
