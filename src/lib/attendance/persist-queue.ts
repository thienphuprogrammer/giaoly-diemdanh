import type { QueuedEvent, ScanQueueState } from "./scan-queue";
import type { CurrentMark } from "./scan-rules";

/**
 * Hàng quét bền: các lượt chưa lưu được giữ trong localStorage (theo người dùng + buổi) để khóa máy,
 * mất mạng, tải lại trang hay đăng nhập lại cũng không mất. Gửi lại dùng đúng `eventId` cũ (máy chủ idempotent).
 * Mã thẻ chỉ nằm trong payload gửi lại này và bị xóa ngay khi lượt đã lưu, bị từ chối hoặc được bỏ qua.
 * Mọi truy cập storage đều trong try/catch: bộ nhớ hỏng hoặc bị chặn thì coi như rỗng, không bao giờ ném lỗi.
 */
export const QUEUE_SCHEMA_VERSION = 1;
export const QUEUE_STORAGE_PREFIX = "diemdanh.scanQueue";
export const MAX_PERSISTED = 50;
/** Lượt để quá lâu (bỏ dở từ tuần trước) thì bỏ: không gửi lại một buổi đã cũ. */
export const PERSIST_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Tập con của `Storage` mà module cần; cho phép truyền bộ nhớ giả khi test. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedEvent {
  eventId: string;
  kind: "scan" | "manual";
  studentId: string;
  fullName: string;
  saintName: string | null;
  mode: "present" | "late";
  token?: string;
  confirmStatus?: "present" | "late";
  optimisticStatus: "present" | "late";
  prev: CurrentMark | null;
  capturedAt: string;
  attempts: number;
  failed: boolean;
}

interface StoredQueue { v: number; savedAt: number; events: unknown }

export const queueStorageKey = (userId: string, sessionId: string): string =>
  `${QUEUE_STORAGE_PREFIX}.v${QUEUE_SCHEMA_VERSION}:${userId}:${sessionId}`;

const UNSAVED = new Set(["sending", "failed"]);

/** Các lượt chưa lưu (đang gửi hoặc đã thử hết lần), tối đa MAX_PERSISTED lượt mới nhất. */
export function toPersisted(s: ScanQueueState): PersistedEvent[] {
  return s.events.filter((e) => UNSAVED.has(e.state)).slice(-MAX_PERSISTED).map(pick);
}

function pick(e: QueuedEvent): PersistedEvent {
  return {
    eventId: e.eventId, kind: e.kind, studentId: e.studentId, fullName: e.fullName, saintName: e.saintName, mode: e.mode,
    ...(e.kind === "scan" && e.token !== undefined ? { token: e.token } : {}),
    ...(e.confirmStatus !== undefined ? { confirmStatus: e.confirmStatus } : {}),
    optimisticStatus: e.optimisticStatus, prev: e.prev, capturedAt: e.capturedAt, attempts: e.attempts, failed: e.state === "failed",
  };
}

export const serializeQueue = (events: readonly PersistedEvent[], now: number): string =>
  JSON.stringify({ v: QUEUE_SCHEMA_VERSION, savedAt: now, events } satisfies StoredQueue);

/** Đọc lại hàng đã lưu. Dữ liệu hỏng, sai phiên bản hoặc quá hạn => rỗng; từng mục sai định dạng bị bỏ. */
export function parseQueue(raw: string | null, now: number): PersistedEvent[] {
  const stored = readStored(raw);
  if (!stored || !Array.isArray(stored.events) || isExpired(stored, now)) return [];
  const seen = new Set<string>();
  const out: PersistedEvent[] = [];
  for (const item of stored.events) {
    const ev = validEvent(item);
    if (!ev || seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    out.push(ev);
  }
  return out.slice(-MAX_PERSISTED);
}

function readStored(raw: string | null): StoredQueue | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.v !== QUEUE_SCHEMA_VERSION || typeof value.savedAt !== "number") return null;
    return { v: value.v, savedAt: value.savedAt, events: value.events };
  } catch {
    return null;
  }
}

const isExpired = (stored: StoredQueue, now: number): boolean => now - stored.savedAt > PERSIST_TTL_MS;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isMode = (v: unknown): v is "present" | "late" => v === "present" || v === "late";
const STATUSES = new Set(["present", "late", "absent_excused", "absent_unexcused"]);

function validPrev(v: unknown): CurrentMark | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || typeof v.status !== "string" || !STATUSES.has(v.status)) return undefined;
  if (v.reason !== null && typeof v.reason !== "string") return undefined;
  return { status: v.status as CurrentMark["status"], reason: v.reason };
}

function validEvent(v: unknown): PersistedEvent | null {
  if (!isRecord(v)) return null;
  const { eventId, kind, studentId, fullName, saintName, mode, token, confirmStatus, optimisticStatus, capturedAt, attempts, failed } = v;
  if (!isStr(eventId) || !isStr(studentId) || typeof fullName !== "string" || !isStr(capturedAt)) return null;
  if (kind !== "scan" && kind !== "manual") return null;
  if (kind === "scan" && !isStr(token)) return null;
  if (saintName !== null && typeof saintName !== "string") return null;
  if (!isMode(mode) || !isMode(optimisticStatus) || (confirmStatus !== undefined && !isMode(confirmStatus))) return null;
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0 || typeof failed !== "boolean") return null;
  const prev = validPrev(v.prev);
  if (prev === undefined) return null;
  return {
    eventId, kind, studentId, fullName, saintName, mode,
    ...(kind === "scan" ? { token: token as string } : {}),
    ...(confirmStatus !== undefined ? { confirmStatus } : {}),
    optimisticStatus, prev, capturedAt, attempts, failed,
  };
}

export function loadQueue(storage: StorageLike | null, key: string, now: number): PersistedEvent[] {
  if (!storage) return [];
  try {
    return parseQueue(storage.getItem(key), now);
  } catch {
    return [];
  }
}

/** Ghi hàng; hàng rỗng thì xóa hẳn mục (cùng các mã thẻ trong đó). Hết dung lượng hoặc bị chặn => "failed". */
export function saveQueue(storage: StorageLike | null, key: string, events: readonly PersistedEvent[], now: number): "saved" | "cleared" | "failed" {
  if (!storage) return "failed";
  try {
    if (events.length === 0) {
      storage.removeItem(key);
      return "cleared";
    }
    storage.setItem(key, serializeQueue(events, now));
    return "saved";
  } catch {
    return "failed";
  }
}

/** Dọn các hàng quét đã quá hạn hoặc hỏng của mọi buổi. Trả về số mục đã xóa. */
export function sweepStaleQueues(storage: StorageLike | null, now: number): number {
  if (!storage) return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(`${QUEUE_STORAGE_PREFIX}.`)) keys.push(k);
    }
    const stale = keys.filter((k) => {
      const stored = readStored(storage.getItem(k));
      return !stored || isExpired(stored, now);
    });
    stale.forEach((k) => storage.removeItem(k));
    return stale.length;
  } catch {
    return 0;
  }
}
