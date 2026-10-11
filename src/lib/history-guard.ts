/**
 * Chặn nút Back (Android/trình duyệt) khi còn việc chưa lưu: đặt thêm một mục lịch sử "lính gác" cùng URL.
 * Back sẽ chỉ bỏ lính gác (vẫn ở trang này) => đặt lại lính gác và hỏi. Logic thuần, hook chỉ thực thi `effect`.
 *
 * Khi đã lưu hết, lính gác được giữ nguyên (không tự lùi lịch sử để tránh đua với điều hướng của người dùng);
 * lần Back sau sẽ tự đi tiếp qua lính gác tới trang trước thật.
 */
export type LeaveIntent = { kind: "href"; href: string } | { kind: "back" };
export interface HistoryGuardState { armed: boolean; exiting: LeaveIntent | null }
export type GuardEffect =
  | { kind: "none" }
  | { kind: "push" }
  | { kind: "prompt" }
  | { kind: "back" }
  | { kind: "go"; delta: number }
  | { kind: "navigate"; href: string };
export interface GuardStep { state: HistoryGuardState; effect: GuardEffect }

export const initialHistoryGuard: HistoryGuardState = { armed: false, exiting: null };
const NONE: GuardEffect = { kind: "none" };

export function armGuard(s: HistoryGuardState, blocking: boolean): GuardStep {
  if (!blocking || s.armed || s.exiting) return { state: s, effect: NONE };
  return { state: { armed: true, exiting: null }, effect: { kind: "push" } };
}

export function guardPop(s: HistoryGuardState, blocking: boolean): GuardStep {
  if (s.exiting?.kind === "href") return { state: initialHistoryGuard, effect: { kind: "navigate", href: s.exiting.href } };
  if (s.exiting || !s.armed) return { state: s, effect: NONE };
  if (blocking) return { state: s, effect: { kind: "prompt" } }; // hook đặt lại lính gác rồi hỏi
  return { state: initialHistoryGuard, effect: { kind: "back" } };
}

export function guardLeave(s: HistoryGuardState, intent: LeaveIntent): GuardStep {
  if (intent.kind === "back") {
    return { state: { armed: false, exiting: intent }, effect: s.armed ? { kind: "go", delta: -2 } : { kind: "back" } };
  }
  if (!s.armed) return { state: s, effect: { kind: "navigate", href: intent.href } };
  return { state: { armed: false, exiting: intent }, effect: { kind: "back" } };
}
