import { describe, expect, it } from "vitest";
import {
  MAX_PERSISTED, PERSIST_TTL_MS, QUEUE_SCHEMA_VERSION, loadQueue, parseQueue, queueStorageKey, saveQueue, serializeQueue,
  sweepStaleQueues, toPersisted, type PersistedEvent, type StorageLike,
} from "./persist-queue";
import { initialQueue, queueReducer, type QueuedEvent, type ScanQueueState } from "./scan-queue";

const NOW = Date.UTC(2026, 9, 12, 8, 0, 0);
// Mã thẻ giả trong test: chuỗi ngắn rõ ràng là không phải bí mật.
const fakeToken = (n: number) => `card-${n}`;

const queued = (id: string, extra: Partial<QueuedEvent> = {}): QueuedEvent => ({
  eventId: id, kind: "scan", studentId: `s-${id}`, fullName: `Em ${id}`, saintName: null, mode: "present",
  token: fakeToken(1), optimisticStatus: "present", prev: null, capturedAt: "2026-10-12T08:00:00.000Z",
  state: "sending", inFlight: false, attempts: 0, undoBusy: false, ...extra,
});
const state = (...events: QueuedEvent[]): ScanQueueState => ({ events });

/** Bộ nhớ giả theo giao diện Storage; `quota` làm setItem ném lỗi như trình duyệt hết dung lượng. */
function memoryStorage(seed: Record<string, string> = {}, opts: { quota?: boolean; broken?: boolean } = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  const guard = () => { if (opts.broken) throw new Error("SecurityError"); };
  return {
    data,
    get length() { guard(); return data.size; },
    key: (i) => { guard(); return [...data.keys()][i] ?? null; },
    getItem: (k) => { guard(); return data.get(k) ?? null; },
    setItem: (k, v) => {
      guard();
      if (opts.quota) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => { guard(); data.delete(k); },
  };
}

describe("queueStorageKey", () => {
  it("scopes the queue by user and session", () => {
    expect(queueStorageKey("u1", "ss1")).not.toBe(queueStorageKey("u2", "ss1"));
    expect(queueStorageKey("u1", "ss1")).not.toBe(queueStorageKey("u1", "ss2"));
    expect(queueStorageKey("u1", "ss1")).toContain(`v${QUEUE_SCHEMA_VERSION}`);
  });
});

describe("toPersisted", () => {
  it("keeps only unsaved events (sending, failed) with the payload needed to resend", () => {
    const out = toPersisted(state(
      queued("a"),
      queued("b", { state: "failed", attempts: 4 }),
      queued("c", { state: "saved", result: "applied" }),
      queued("d", { state: "rejected", message: "x" }),
      queued("e", { state: "needs_confirm" }),
      queued("f", { state: "undone" }),
      queued("g", { kind: "manual", token: undefined, confirmStatus: "late", optimisticStatus: "late", inFlight: true, attempts: 2 }),
    ));
    expect(out.map((e) => e.eventId)).toEqual(["a", "b", "g"]);
    expect(out[1]).toMatchObject({ failed: true, attempts: 4 });
    expect(out[2]).toEqual({
      eventId: "g", kind: "manual", studentId: "s-g", fullName: "Em g", saintName: null, mode: "present",
      confirmStatus: "late", optimisticStatus: "late", prev: null, capturedAt: "2026-10-12T08:00:00.000Z", attempts: 2, failed: false,
    });
    expect(out[2]).not.toHaveProperty("token");
  });

  it("caps the stored queue at the newest MAX_PERSISTED events", () => {
    const many = Array.from({ length: MAX_PERSISTED + 5 }, (_, i) => queued(`e${i}`));
    const out = toPersisted(state(...many));
    expect(out).toHaveLength(MAX_PERSISTED);
    expect(out[0].eventId).toBe("e5");
    expect(out.at(-1)?.eventId).toBe(`e${MAX_PERSISTED + 4}`);
  });
});

describe("serialize / parse", () => {
  it("round-trips the persisted events", () => {
    const events = toPersisted(state(queued("a", { prev: { status: "absent_excused", reason: "ốm" } }), queued("b", { state: "failed", attempts: 4, saintName: "Phêrô" })));
    expect(parseQueue(serializeQueue(events, NOW), NOW)).toEqual(events);
  });

  it("returns an empty queue for missing, corrupt or non-object data", () => {
    expect(parseQueue(null, NOW)).toEqual([]);
    expect(parseQueue("{not json", NOW)).toEqual([]);
    expect(parseQueue("42", NOW)).toEqual([]);
    expect(parseQueue("null", NOW)).toEqual([]);
    expect(parseQueue(JSON.stringify({ v: QUEUE_SCHEMA_VERSION, savedAt: NOW, events: "nope" }), NOW)).toEqual([]);
  });

  it("ignores data written by another schema version", () => {
    const raw = JSON.parse(serializeQueue(toPersisted(state(queued("a"))), NOW));
    expect(parseQueue(JSON.stringify({ ...raw, v: QUEUE_SCHEMA_VERSION + 1 }), NOW)).toEqual([]);
  });

  it("drops a stale queue older than the TTL", () => {
    const raw = serializeQueue(toPersisted(state(queued("a"))), NOW);
    expect(parseQueue(raw, NOW + PERSIST_TTL_MS - 1)).toHaveLength(1);
    expect(parseQueue(raw, NOW + PERSIST_TTL_MS + 1)).toEqual([]);
  });

  it("drops malformed entries but keeps valid ones, and dedupes by eventId", () => {
    const good = toPersisted(state(queued("a")))[0];
    const raw = JSON.stringify({
      v: QUEUE_SCHEMA_VERSION, savedAt: NOW,
      events: [good, { ...good }, { ...good, eventId: 7 }, { ...good, eventId: "x", kind: "hack" }, { ...good, eventId: "y", mode: "absent" },
        { ...good, eventId: "z", kind: "scan", token: undefined }, { ...good, eventId: "w", attempts: -1 }, { ...good, eventId: "p", prev: { status: "bad" } }, null],
    });
    expect(parseQueue(raw, NOW).map((e) => e.eventId)).toEqual(["a"]);
  });

  it("never keeps more than MAX_PERSISTED events from storage", () => {
    const events = Array.from({ length: MAX_PERSISTED + 3 }, (_, i) => ({ ...toPersisted(state(queued(`e${i}`)))[0] }));
    const raw = JSON.stringify({ v: QUEUE_SCHEMA_VERSION, savedAt: NOW, events });
    expect(parseQueue(raw, NOW)).toHaveLength(MAX_PERSISTED);
  });
});

describe("loadQueue / saveQueue", () => {
  const key = queueStorageKey("u1", "ss1");
  const events = (): PersistedEvent[] => toPersisted(state(queued("a"), queued("b", { token: fakeToken(2) })));

  it("saves and loads through storage", () => {
    const store = memoryStorage();
    expect(saveQueue(store, key, events(), NOW)).toBe("saved");
    expect(loadQueue(store, key, NOW)).toEqual(events());
  });

  it("removes the entry (and its tokens) when nothing is left to send", () => {
    const store = memoryStorage();
    saveQueue(store, key, events(), NOW);
    expect(saveQueue(store, key, [], NOW)).toBe("cleared");
    expect(store.data.has(key)).toBe(false);
  });

  it("reports failure instead of throwing when storage is full", () => {
    expect(saveQueue(memoryStorage({}, { quota: true }), key, events(), NOW)).toBe("failed");
  });

  it("survives storage that throws on every access, or no storage at all", () => {
    const broken = memoryStorage({}, { broken: true });
    expect(saveQueue(broken, key, events(), NOW)).toBe("failed");
    expect(loadQueue(broken, key, NOW)).toEqual([]);
    expect(saveQueue(null, key, events(), NOW)).toBe("failed");
    expect(loadQueue(null, key, NOW)).toEqual([]);
  });

  it("treats a corrupt stored value as empty and leaves other keys alone", () => {
    const store = memoryStorage({ [key]: "{oops", other: "keep" });
    expect(loadQueue(store, key, NOW)).toEqual([]);
    expect(store.data.get("other")).toBe("keep");
  });
});

describe("sweepStaleQueues", () => {
  it("removes expired or unreadable scan queues of any session, keeping fresh ones and unrelated keys", () => {
    const fresh = queueStorageKey("u1", "ss-fresh");
    const old = queueStorageKey("u1", "ss-old");
    const junk = queueStorageKey("u1", "ss-junk");
    const store = memoryStorage({
      [fresh]: serializeQueue(toPersisted(state(queued("a"))), NOW),
      [old]: serializeQueue(toPersisted(state(queued("b"))), NOW - PERSIST_TTL_MS - 1),
      [junk]: "{",
      "scan-feedback": "off",
    });
    expect(sweepStaleQueues(store, NOW)).toBe(2);
    expect([...store.data.keys()].sort()).toEqual([fresh, "scan-feedback"].sort());
  });

  it("does not throw when storage is unavailable", () => {
    expect(sweepStaleQueues(memoryStorage({}, { broken: true }), NOW)).toBe(0);
    expect(sweepStaleQueues(null, NOW)).toBe(0);
  });
});

describe("restoring into the reducer", () => {
  const persisted = (...evs: QueuedEvent[]) => toPersisted(state(...evs));

  it("restores persisted events ahead of new ones, as unsent and not in flight", () => {
    const { eventId, kind, studentId, fullName, saintName, mode, token, optimisticStatus, prev, capturedAt, undoBusy } = queued("new");
    const live = queueReducer(initialQueue, { type: "enqueue", event: { eventId, kind, studentId, fullName, saintName, mode, token, optimisticStatus, prev, capturedAt, undoBusy } });
    const s = queueReducer(live, { type: "restore", events: persisted(queued("old1", { inFlight: true, attempts: 2 }), queued("old2", { state: "failed", attempts: 4 })) });
    expect(s.events.map((e) => [e.eventId, e.state, e.inFlight, e.attempts])).toEqual([
      ["old1", "sending", false, 2], ["old2", "failed", false, 4], ["new", "sending", false, 0],
    ]);
    expect(s.events[0]).toMatchObject({ undoBusy: false, token: fakeToken(1), notBefore: undefined });
  });

  it("dedupes by eventId: an event already in memory is not restored twice", () => {
    let s = queueReducer(initialQueue, { type: "restore", events: persisted(queued("a")) });
    s = queueReducer(s, { type: "started", eventId: "a" });
    s = queueReducer(s, { type: "restore", events: persisted(queued("a"), queued("b")) });
    expect(s.events.map((e) => e.eventId)).toEqual(["b", "a"]);
    expect(s.events.find((e) => e.eventId === "a")?.inFlight).toBe(true);
  });
});
