import type { QueuedEvent, ScanQueueState } from "./scan-queue";
import type { CurrentMark } from "./scan-rules";
import type { AttendanceStatus } from "./warning";

/**
 * Hàng quét bền: các lượt chưa lưu được giữ trong localStorage (theo người dùng + buổi) để khóa máy,
 * mất mạng, tải lại trang hay đăng nhập lại cũng không mất. Gửi lại dùng đúng `eventId` cũ (máy chủ idempotent).
 * Mã thẻ chỉ nằm trong payload gửi lại này và bị xóa ngay khi lượt đã lưu, bị từ chối hoặc được bỏ qua.
 * Lượt "cần chọn" (máy chủ đã trả lời, chờ người dùng chọn Có mặt/Đi muộn) cũng được giữ, chỉ để hiển thị:
 * không có mã thẻ, không bao giờ gửi lại.
 * Mọi truy cập storage đều trong try/catch: bộ nhớ hỏng hoặc bị chặn thì coi như rỗng, không bao giờ ném lỗi.
 */
export const QUEUE_SCHEMA_VERSION = 1;
export const QUEUE_STORAGE_PREFIX = "diemdanh.scanQueue";
/** Tối đa số lượt chưa gửi (đang gửi + chưa gửi được) giữ trên máy; lượt "cần chọn" có hạn mức riêng bằng số này. */
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
  /** Lượt "cần chọn" chỉ để hiển thị lại; thiếu trường này = lượt cần gửi (dữ liệu ghi trước khi có trường). */
  needsConfirm?: true;
  serverStatus?: AttendanceStatus | null;
}

interface StoredQueue { v: number; savedAt: number; events: unknown }

export const queueStorageKey = (userId: string, sessionId: string): string =>
  `${QUEUE_STORAGE_PREFIX}.v${QUEUE_SCHEMA_VERSION}:${userId}:${sessionId}`;

const isUnsent = (e: QueuedEvent): boolean => e.state === "sending" || e.state === "failed";

/** Giữ tối đa MAX_PERSISTED lượt mới nhất của mỗi loại (chưa gửi / cần chọn), theo đúng thứ tự trong hàng. */
function capByKind<T>(items: readonly T[], unsent: (item: T) => boolean): T[] {
  const keepUnsent = new Set(items.filter(unsent).slice(-MAX_PERSISTED));
  const keepConfirm = new Set(items.filter((i) => !unsent(i)).slice(-MAX_PERSISTED));
  return items.filter((i) => keepUnsent.has(i) || keepConfirm.has(i));
}

/** Các lượt chưa lưu (đang gửi hoặc đã thử hết lần) và lượt "cần chọn" (chỉ hiển thị), mỗi loại tối đa MAX_PERSISTED. */
export function toPersisted(s: ScanQueueState): PersistedEvent[] {
  return capByKind(s.events.filter((e) => isUnsent(e) || e.state === "needs_confirm"), isUnsent).map(pick);
}

/** Số lượt chưa gửi vượt hạn mức: các lượt cũ nhất sẽ không được giữ trên máy. */
export const persistOverflow = (s: ScanQueueState): boolean => s.events.filter(isUnsent).length > MAX_PERSISTED;

function pick(e: QueuedEvent): PersistedEvent {
  const confirm = e.state === "needs_confirm";
  return {
    eventId: e.eventId, kind: e.kind, studentId: e.studentId, fullName: e.fullName, saintName: e.saintName, mode: e.mode,
    ...(!confirm && e.kind === "scan" && e.token !== undefined ? { token: e.token } : {}),
    ...(e.confirmStatus !== undefined ? { confirmStatus: e.confirmStatus } : {}),
    optimisticStatus: e.optimisticStatus, prev: e.prev, capturedAt: e.capturedAt, attempts: e.attempts, failed: e.state === "failed",
    ...(confirm ? { needsConfirm: true as const, serverStatus: e.serverStatus ?? null } : {}),
  };
}

/**
 * Hai tab cùng một buổi dùng chung một khóa: trước khi ghi, giữ các mục của tab khác (eventId tab này chưa từng thấy)
 * rồi hợp với hàng của tab này. Mục tab này đã thấy mà không còn trong hàng => đã lưu/bỏ ở đây => bỏ khỏi bộ nhớ.
 */
export function mergeForWrite(stored: readonly PersistedEvent[], mine: readonly PersistedEvent[], seen: ReadonlySet<string>): PersistedEvent[] {
  const mineIds = new Set(mine.map((e) => e.eventId));
  const others = stored.filter((e) => !seen.has(e.eventId) && !mineIds.has(e.eventId));
  return capByKind([...others, ...mine], (e) => !e.needsConfirm);
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
  return capByKind(out, (e) => !e.needsConfirm);
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
  const { eventId, kind, studentId, fullName, saintName, mode, token, confirmStatus, optimisticStatus, capturedAt, attempts, failed, needsConfirm, serverStatus } = v;
  if (!isStr(eventId) || !isStr(studentId) || typeof fullName !== "string" || !isStr(capturedAt)) return null;
  if (kind !== "scan" && kind !== "manual") return null;
  if (needsConfirm !== undefined && needsConfirm !== true) return null;
  const confirm = needsConfirm === true;
  if (confirm && serverStatus !== null && !(typeof serverStatus === "string" && STATUSES.has(serverStatus))) return null;
  if (!confirm && kind === "scan" && !isStr(token)) return null;
  if (saintName !== null && typeof saintName !== "string") return null;
  if (!isMode(mode) || !isMode(optimisticStatus) || (confirmStatus !== undefined && !isMode(confirmStatus))) return null;
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0 || typeof failed !== "boolean") return null;
  const prev = validPrev(v.prev);
  if (prev === undefined) return null;
  return {
    eventId, kind, studentId, fullName, saintName, mode,
    ...(!confirm && kind === "scan" ? { token: token as string } : {}),
    ...(confirmStatus !== undefined ? { confirmStatus } : {}),
    optimisticStatus, prev, capturedAt, attempts, failed,
    ...(confirm ? { needsConfirm: true as const, serverStatus: serverStatus as AttendanceStatus | null } : {}),
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

function queueKeys(storage: StorageLike, userId?: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k?.startsWith(`${QUEUE_STORAGE_PREFIX}.`)) continue;
    if (userId === undefined || k.split(":")[1] === userId) keys.push(k);
  }
  return keys;
}

/** Số lượt chưa gửi (không tính lượt "cần chọn") của một người dùng trên máy này, mọi buổi. Dùng để cảnh báo khi đăng xuất. */
/** Số lượt chưa gửi (không tính lượt "cần chọn") của MỘT người dùng + buổi trên máy này (bảng điểm danh dùng). */
export function countUnsentInQueue(storage: StorageLike | null, key: string, now: number): number {
  return loadQueue(storage, key, now).filter((e) => !e.needsConfirm).length;
}

/** `window.localStorage`, hoặc null khi không có (máy chủ) hay bị chặn (chế độ riêng tư, chính sách trình duyệt). */
export function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function countUnsentForUser(storage: StorageLike | null, userId: string, now: number): number {
  if (!storage) return 0;
  try {
    return queueKeys(storage, userId).reduce((n, k) => n + loadQueue(storage, k, now).filter((e) => !e.needsConfirm).length, 0);
  } catch {
    return 0;
  }
}

/** Xóa mọi hàng quét (cùng mã thẻ) của một người dùng trên máy này. Trả về số khóa đã xóa. */
export function clearUserQueues(storage: StorageLike | null, userId: string): number {
  if (!storage) return 0;
  try {
    const keys = queueKeys(storage, userId);
    keys.forEach((k) => storage.removeItem(k));
    return keys.length;
  } catch {
    return 0;
  }
}

/** Dọn các hàng quét đã quá hạn hoặc hỏng của mọi buổi. Trả về số mục đã xóa. */
export function sweepStaleQueues(storage: StorageLike | null, now: number): number {
  if (!storage) return 0;
  try {
    const keys = queueKeys(storage);
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

/**
 * Ghi hàng của tab này (hợp với mục của tab khác, xem `mergeForWrite`). Trả về false khi không giữ được đủ trên máy:
 * bộ nhớ đầy/bị chặn, hoặc số lượt chưa gửi vượt hạn mức.
 */
export function persistState(storage: StorageLike | null, key: string, state: ScanQueueState, seen: ReadonlySet<string>, now: number): boolean {
  const merged = mergeForWrite(loadQueue(storage, key, now), toPersisted(state), seen);
  return saveQueue(storage, key, merged, now) !== "failed" && !persistOverflow(state);
}
