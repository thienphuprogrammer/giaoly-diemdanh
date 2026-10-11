import { describe, expect, it } from "vitest";
import { MAX_SEND_ATTEMPTS, backoffMs, canEnqueue, initialQueue, nextWakeAt, pendingCount, unsavedSummary, queueReducer, recentEvents, sendable, summarizeQueue, type QueuedEvent, type ScanQueueState } from "./scan-queue";

const ev = (id: string, studentId = "s1", extra: Partial<QueuedEvent> = {}) => ({
  eventId: id, kind: "scan" as const, studentId, fullName: "An", saintName: null, mode: "present" as const,
  token: "t", optimisticStatus: "present" as const, prev: null, capturedAt: "2026-10-11T08:00:00.000Z", undoBusy: false, ...extra,
});
const enqueue = (s: ScanQueueState, ...evs: ReturnType<typeof ev>[]) => evs.reduce((acc, e) => queueReducer(acc, { type: "enqueue", event: e }), s);

describe("queueReducer", () => {
  it("enqueues as sending and offers it for sending once", () => {
    let s = enqueue(initialQueue, ev("e1"));
    expect(sendable(s).map((e) => e.eventId)).toEqual(["e1"]);
    s = queueReducer(s, { type: "started", eventId: "e1" });
    expect(sendable(s)).toEqual([]);
  });

  it("sends one event per student at a time, in order; other students go in parallel", () => {
    const s = enqueue(initialQueue, ev("a1", "A"), ev("a2", "A"), ev("b1", "B"));
    expect(sendable(s).map((e) => e.eventId)).toEqual(["a1", "b1"]);
    const afterA1 = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "resolved", eventId: "a1", result: "applied", status: "present" });
    expect(sendable(afterA1).map((e) => e.eventId)).toEqual(["a2", "b1"]);
  });

  it("resolved applied/noop become saved; needs_confirm and rejected need action", () => {
    let s = enqueue(initialQueue, ev("e1", "A"), ev("e2", "B"), ev("e3", "C"));
    s = queueReducer(s, { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "needs_confirm", eventId: "e2", status: "absent_unexcused" });
    s = queueReducer(s, { type: "rejected", eventId: "e3", message: "Thẻ không dùng được cho lớp này" });
    expect(summarizeQueue(s)).toEqual({ saved: 1, sending: 0, needsAction: 2 });
    expect(s.events.find((e) => e.eventId === "e3")?.message).toBe("Thẻ không dùng được cho lớp này");
  });

  it("noop results are saved but do not count as newly recorded students", () => {
    const s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "noop", status: "present" });
    expect(summarizeQueue(s)).toEqual({ saved: 0, sending: 0, needsAction: 0 });
    expect(s.events[0].state).toBe("saved");
  });

  it("network errors retry with the same event until attempts run out, then need action", () => {
    let s = enqueue(initialQueue, ev("e1"));
    for (let i = 0; i < 2; i++) {
      s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 0, waitMs: 0 });
      expect(s.events[0]).toMatchObject({ state: "sending", inFlight: false, attempts: i + 1 });
    }
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 0, waitMs: null });
    expect(s.events[0]).toMatchObject({ state: "failed", attempts: 3 });
    expect(summarizeQueue(s).needsAction).toBe(1);
    s = queueReducer(s, { type: "retry", eventId: "e1" });
    expect(s.events[0]).toMatchObject({ state: "sending", attempts: 0, inFlight: false, notBefore: undefined });
  });

  it("does not offer a retried event again before its back-off has passed", () => {
    let s = enqueue(initialQueue, ev("e1"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 3, now: 1000, waitMs: 500 });
    expect(sendable(s, 1200)).toEqual([]);
    expect(sendable(s, 1500).map((e) => e.eventId)).toEqual(["e1"]);
  });

  it("undone events no longer count as saved", () => {
    let s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "undone", eventId: "e1" });
    expect(s.events[0].state).toBe("undone");
    expect(summarizeQueue(s).saved).toBe(0);
  });

  it("tracks undo progress and errors per event", () => {
    let s = queueReducer(enqueue(initialQueue, ev("e1")), { type: "resolved", eventId: "e1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "undo_started", eventId: "e1" });
    expect(s.events[0].undoBusy).toBe(true);
    expect(pendingCount(s)).toBe(1);
    s = queueReducer(s, { type: "undo_failed", eventId: "e1", message: "Bản ghi đã thay đổi" });
    expect(s.events[0]).toMatchObject({ undoBusy: false, undoError: "Bản ghi đã thay đổi", state: "saved" });
  });

  it("limits the number of events still waiting to be sent", () => {
    let s = initialQueue;
    for (let i = 0; i < 50; i++) s = enqueue(s, ev(`e${i}`, `s${i}`));
    expect(canEnqueue(s)).toBe(false);
    expect(canEnqueue(s, 51)).toBe(true);
    expect(pendingCount(s)).toBe(50);
  });

  it("dismisses a settled event that needed action so it no longer counts", () => {
    let s = enqueue(initialQueue, ev("e1", "A"), ev("e2", "B"));
    s = queueReducer(s, { type: "needs_confirm", eventId: "e1", status: "absent_excused" });
    s = queueReducer(s, { type: "dismiss", eventId: "e1" });
    s = queueReducer(s, { type: "dismiss", eventId: "e2" }); // still sending: must stay
    expect(s.events.map((e) => e.eventId)).toEqual(["e2"]);
    expect(summarizeQueue(s)).toEqual({ saved: 0, sending: 1, needsAction: 0 });
  });

  it("does not count a network error retry beyond the limit as sending", () => {
    let s = enqueue(initialQueue, ev("e1"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "network_error", eventId: "e1", maxAttempts: 1, now: 0, waitMs: null });
    expect(s.events[0]).toMatchObject({ state: "failed", inFlight: false });
    expect(sendable(s, 10_000)).toEqual([]);
  });

  it("lists recent events newest first", () => {
    const s = enqueue(initialQueue, ev("e1", "A"), ev("e2", "B"), ev("e3", "C"));
    expect(recentEvents(s, 2).map((e) => e.eventId)).toEqual(["e3", "e2"]);
  });
});

describe("failed and rejected events", () => {
  const fail = (s: ScanQueueState, id: string, now = 0) => {
    let out = s;
    for (let i = 0; i < MAX_SEND_ATTEMPTS; i++) {
      const attempt = i + 1;
      out = queueReducer(queueReducer(out, { type: "started", eventId: id }), { type: "network_error", eventId: id, maxAttempts: MAX_SEND_ATTEMPTS, now, waitMs: attempt >= MAX_SEND_ATTEMPTS ? null : backoffMs(attempt) });
    }
    return out;
  };

  it("uses every step of the 0.5s / 1.5s / 4s schedule before giving up", () => {
    expect(MAX_SEND_ATTEMPTS).toBe(4);
    expect(Array.from({ length: MAX_SEND_ATTEMPTS - 1 }, (_, i) => backoffMs(i + 1))).toEqual([500, 1500, 4000]);
    const s = fail(enqueue(initialQueue, ev("e1")), "e1");
    expect(s.events[0]).toMatchObject({ state: "failed", attempts: 4 });
  });

  it("dismisses failed and rejected events", () => {
    let s = fail(enqueue(initialQueue, ev("e1", "A"), ev("e2", "B")), "e1");
    s = queueReducer(s, { type: "rejected", eventId: "e2", message: "Bị từ chối" });
    s = queueReducer(queueReducer(s, { type: "dismiss", eventId: "e1" }), { type: "dismiss", eventId: "e2" });
    expect(s.events).toEqual([]);
    expect(summarizeQueue(s).needsAction).toBe(0);
  });

  it("makes a failed event sendable again right away after retry", () => {
    let s = fail(enqueue(initialQueue, ev("e1")), "e1", 1000);
    expect(sendable(s, 1_000_000)).toEqual([]);
    s = queueReducer(s, { type: "retry", eventId: "e1" });
    expect(sendable(s, 0).map((e) => e.eventId)).toEqual(["e1"]);
  });

  it("holds back a later event of the same student while an earlier one waits out its back-off", () => {
    let s = enqueue(initialQueue, ev("a1", "A"), ev("a2", "A"), ev("b1", "B"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "network_error", eventId: "a1", maxAttempts: 4, now: 1000, waitMs: 1500 });
    expect(sendable(s, 1200).map((e) => e.eventId)).toEqual(["b1"]);
    expect(sendable(s, 2500).map((e) => e.eventId)).toEqual(["a1", "b1"]);
  });

  it("counts failed events as unsaved, separately from those still sending", () => {
    let s = fail(enqueue(initialQueue, ev("e1", "A"), ev("e2", "B")), "e1");
    expect(unsavedSummary(s)).toEqual({ sending: 1, failed: 1, total: 2 });
    expect(pendingCount(s)).toBe(2);
    s = queueReducer(s, { type: "dismiss", eventId: "e1" });
    expect(unsavedSummary(s)).toEqual({ sending: 1, failed: 0, total: 1 });
  });
});

describe("nextWakeAt", () => {
  it("returns the earliest future back-off deadline among waiting events", () => {
    let s = enqueue(initialQueue, ev("a1", "A"), ev("b1", "B"), ev("c1", "C"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "network_error", eventId: "a1", maxAttempts: 4, now: 1000, waitMs: 1500 });
    s = queueReducer(queueReducer(s, { type: "started", eventId: "b1" }), { type: "network_error", eventId: "b1", maxAttempts: 4, now: 1000, waitMs: 500 });
    expect(nextWakeAt(s, 1200)).toBe(1500);
    expect(nextWakeAt(s, 1600)).toBe(2500);
    expect(nextWakeAt(s, 3000)).toBeNull();
  });

  it("ignores events that are not waiting to be sent", () => {
    let s = enqueue(initialQueue, ev("a1"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "network_error", eventId: "a1", maxAttempts: 1, now: 1000, waitMs: null });
    expect(nextWakeAt(s, 0)).toBeNull();
  });
});

describe("backoffMs", () => {
  it("waits 0.5s, 1.5s, 4s and then gives up", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([500, 1500, 4000]);
    expect(backoffMs(4)).toBeNull();
  });
});

describe("resume and auth_wait", () => {
  it("resume makes failed and backing-off events sendable now, with a fresh attempt budget", () => {
    let s = enqueue(initialQueue, ev("a1", "A"), ev("b1", "B"), ev("c1", "C"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "a1" }), { type: "network_error", eventId: "a1", maxAttempts: 1, now: 1000, waitMs: null });
    s = queueReducer(queueReducer(s, { type: "started", eventId: "b1" }), { type: "network_error", eventId: "b1", maxAttempts: 4, now: 1000, waitMs: 4000 });
    s = queueReducer(s, { type: "started", eventId: "c1" });
    s = queueReducer(s, { type: "resume" });
    expect(s.events.map((e) => [e.eventId, e.state, e.attempts, e.notBefore, e.inFlight])).toEqual([
      ["a1", "sending", 0, undefined, false], ["b1", "sending", 0, undefined, false], ["c1", "sending", 0, undefined, true],
    ]);
    expect(sendable(s, 1001).map((e) => e.eventId)).toEqual(["a1", "b1"]);
  });

  it("resume leaves saved, rejected and needs_confirm events untouched", () => {
    let s = enqueue(initialQueue, ev("a1", "A"), ev("b1", "B"));
    s = queueReducer(s, { type: "resolved", eventId: "a1", result: "applied", status: "present" });
    s = queueReducer(s, { type: "rejected", eventId: "b1", message: "x" });
    expect(queueReducer(s, { type: "resume" })).toEqual(s);
  });

  it("auth_wait keeps the event unsent without spending an attempt", () => {
    let s = enqueue(initialQueue, ev("e1"));
    s = queueReducer(queueReducer(s, { type: "started", eventId: "e1" }), { type: "auth_wait", eventId: "e1" });
    expect(s.events[0]).toMatchObject({ state: "sending", inFlight: false, attempts: 0 });
    expect(unsavedSummary(s).total).toBe(1);
  });
});
