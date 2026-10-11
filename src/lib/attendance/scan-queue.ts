import type { CurrentMark, ScanMode } from "./scan-rules";
import type { PersistedEvent } from "./persist-queue";
import type { AttendanceStatus } from "./warning";

export type EventState = "sending" | "saved" | "needs_confirm" | "rejected" | "failed" | "undone";

export interface QueuedEvent {
  eventId: string;
  kind: "scan" | "manual";
  studentId: string;
  fullName: string;
  saintName: string | null;
  mode: ScanMode;
  token?: string;
  confirmStatus?: "present" | "late";
  optimisticStatus: "present" | "late";
  prev: CurrentMark | null;
  capturedAt: string;
  state: EventState;
  inFlight: boolean;
  attempts: number;
  /** Không gửi lại trước mốc này (thời gian chờ giữa các lần thử). */
  notBefore?: number;
  result?: "applied" | "noop";
  serverStatus?: AttendanceStatus | null;
  message?: string;
  undoBusy: boolean;
  undoError?: string;
}
export interface ScanQueueState { events: QueuedEvent[] }
export const initialQueue: ScanQueueState = { events: [] };

export type ScanAction =
  | { type: "enqueue"; event: Omit<QueuedEvent, "state" | "inFlight" | "attempts"> }
  | { type: "started"; eventId: string }
  | { type: "resolved"; eventId: string; result: "applied" | "noop"; status: AttendanceStatus | null }
  | { type: "needs_confirm"; eventId: string; status: AttendanceStatus | null }
  | { type: "rejected"; eventId: string; message: string }
  | { type: "network_error"; eventId: string; maxAttempts: number; now: number; waitMs: number | null }
  | { type: "retry"; eventId: string }
  | { type: "undo_started"; eventId: string }
  | { type: "undone"; eventId: string }
  | { type: "undo_failed"; eventId: string; message: string }
  /** Bỏ một lượt đã xong việc cần xử lý (đã chọn lại, giữ nguyên, hoặc bỏ qua lỗi). Lượt còn đang gửi thì giữ. */
  | { type: "dismiss"; eventId: string }
  /** Nạp lại các lượt chưa lưu từ bộ nhớ máy (mở lại màn quét). Lượt đã có trong hàng thì bỏ qua (theo eventId). */
  | { type: "restore"; events: readonly PersistedEvent[] }
  /** Có mạng lại / tab hiện lại / đăng nhập lại: gửi lại ngay các lượt chưa lưu, với số lần thử mới. */
  | { type: "resume" }
  /** Máy chủ trả 401: giữ lượt trong hàng (không tính là một lần thử) cho tới khi đăng nhập lại. */
  | { type: "auth_wait"; eventId: string };

const patch = (s: ScanQueueState, id: string, change: (e: QueuedEvent) => Partial<QueuedEvent>): ScanQueueState => ({
  events: s.events.map((e) => (e.eventId === id ? { ...e, ...change(e) } : e)),
});

export function queueReducer(s: ScanQueueState, a: ScanAction): ScanQueueState {
  switch (a.type) {
    case "enqueue": return { events: [...s.events, { ...a.event, state: "sending", inFlight: false, attempts: 0 }] };
    case "started": return patch(s, a.eventId, () => ({ inFlight: true }));
    case "resolved": return patch(s, a.eventId, () => ({ state: "saved", inFlight: false, result: a.result, serverStatus: a.status, message: undefined }));
    case "needs_confirm": return patch(s, a.eventId, () => ({ state: "needs_confirm", inFlight: false, serverStatus: a.status }));
    case "rejected": return patch(s, a.eventId, () => ({ state: "rejected", inFlight: false, message: a.message }));
    case "network_error": return patch(s, a.eventId, (e) => {
      const attempts = e.attempts + 1;
      return { inFlight: false, attempts, state: attempts >= a.maxAttempts ? "failed" : "sending", notBefore: a.now + (a.waitMs ?? 0) };
    });
    case "retry": return patch(s, a.eventId, () => ({ state: "sending", attempts: 0, inFlight: false, notBefore: undefined }));
    case "undo_started": return patch(s, a.eventId, () => ({ undoBusy: true, undoError: undefined }));
    case "undone": return patch(s, a.eventId, () => ({ state: "undone", undoBusy: false }));
    case "undo_failed": return patch(s, a.eventId, () => ({ undoBusy: false, undoError: a.message }));
    case "dismiss": return { events: s.events.filter((e) => e.eventId !== a.eventId || !NEEDS_ACTION.has(e.state)) };
    case "restore": {
      const known = new Set(s.events.map((e) => e.eventId));
      const fresh = a.events.filter((p) => !known.has(p.eventId)).map(fromPersisted);
      return fresh.length ? { events: [...fresh, ...s.events] } : s;
    }
    case "resume": {
      if (!s.events.some(isResumable)) return s;
      return { events: s.events.map((e) => (isResumable(e) ? { ...e, state: "sending" as const, attempts: 0, notBefore: undefined } : e)) };
    }
    case "auth_wait": return patch(s, a.eventId, () => ({ inFlight: false, notBefore: undefined }));
  }
}

const isResumable = (e: QueuedEvent): boolean =>
  e.state === "failed" || (e.state === "sending" && (e.attempts > 0 || e.notBefore !== undefined));

function fromPersisted(p: PersistedEvent): QueuedEvent {
  const { failed, ...rest } = p;
  return { ...rest, state: failed ? "failed" : "sending", inFlight: false, undoBusy: false, notBefore: undefined };
}

const NEEDS_ACTION: ReadonlySet<EventState> = new Set(["rejected", "failed", "needs_confirm"]);

export function summarizeQueue(s: ScanQueueState): { saved: number; sending: number; needsAction: number } {
  return {
    saved: s.events.filter((e) => e.state === "saved" && e.result === "applied").length,
    sending: s.events.filter((e) => e.state === "sending").length,
    needsAction: s.events.filter((e) => NEEDS_ACTION.has(e.state)).length,
  };
}

/** Lượt chờ gửi, mỗi em tối đa một lượt tại một thời điểm và theo đúng thứ tự quét. */
export function sendable(s: ScanQueueState, now: number = Date.now()): QueuedEvent[] {
  const busy = new Set(s.events.filter((e) => e.state === "sending" && e.inFlight).map((e) => e.studentId));
  const out: QueuedEvent[] = [];
  for (const e of s.events) {
    if (e.state !== "sending" || e.inFlight || busy.has(e.studentId)) continue;
    if ((e.notBefore ?? 0) > now) { busy.add(e.studentId); continue; } // đang chờ thử lại: không cho lượt sau của cùng em chen lên
    busy.add(e.studentId);
    out.push(e);
  }
  return out;
}

/** Lượt chưa lưu được: đang gửi, hoặc đã thử hết lần mà chưa gửi được (người dùng chưa bỏ qua). */
export function unsavedSummary(s: ScanQueueState): { sending: number; failed: number; total: number } {
  const sending = s.events.filter((e) => e.state === "sending").length;
  const failed = s.events.filter((e) => e.state === "failed").length;
  return { sending, failed, total: sending + failed };
}

/** Số việc còn dở: lượt chưa lưu (đang gửi hoặc gửi hỏng) và hoàn tác đang chạy. Dùng để cảnh báo khi rời trang. */
export const pendingCount = (s: ScanQueueState): number =>
  s.events.filter((e) => e.state === "sending" || e.state === "failed" || e.undoBusy).length;

/** Mốc sớm nhất (sau `now`) mà một lượt đang chờ thử lại được gửi tiếp; null nếu không có. */
export function nextWakeAt(s: ScanQueueState, now: number): number | null {
  const waits = s.events
    .filter((e) => e.state === "sending" && !e.inFlight && e.notBefore !== undefined && e.notBefore > now)
    .map((e) => e.notBefore as number);
  return waits.length ? Math.min(...waits) : null;
}

export const canEnqueue = (s: ScanQueueState, limit = 50): boolean =>
  s.events.filter((e) => e.state === "sending").length < limit;

export const recentEvents = (s: ScanQueueState, n: number): QueuedEvent[] => [...s.events].reverse().slice(0, n);

const BACKOFF = [500, 1500, 4000];
/** Lần gửi đầu + 3 lần thử lại theo lịch 0,5s / 1,5s / 4s, rồi mới coi là "chưa gửi được". */
export const MAX_SEND_ATTEMPTS = BACKOFF.length + 1;
export const backoffMs = (attempt: number): number | null => BACKOFF[attempt - 1] ?? null;
