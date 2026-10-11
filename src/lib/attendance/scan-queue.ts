import type { CurrentMark, ScanMode } from "./scan-rules";
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
  | { type: "dismiss"; eventId: string };

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
  }
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

export const pendingCount = (s: ScanQueueState): number =>
  s.events.filter((e) => e.state === "sending" || e.undoBusy).length;

export const canEnqueue = (s: ScanQueueState, limit = 50): boolean =>
  s.events.filter((e) => e.state === "sending").length < limit;

export const recentEvents = (s: ScanQueueState, n: number): QueuedEvent[] => [...s.events].reverse().slice(0, n);

const BACKOFF = [500, 1500, 4000];
export const backoffMs = (attempt: number): number | null => BACKOFF[attempt - 1] ?? null;
