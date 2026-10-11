import { describe, expect, it } from "vitest";
import { boardReducer, initBoardState, mergeFresh, pendingCount, saveChip, type BoardAction, type BoardState } from "./board-state";
import type { Mark, Marks } from "./marks";

const P: Mark = { status: "present", reason: null };
const A: Mark = { status: "absent_unexcused", reason: null };
const L: Mark = { status: "late", reason: null };

const run = (state: BoardState, ...actions: BoardAction[]) => actions.reduce(boardReducer, state);

describe("mergeFresh", () => {
  it("takes server values except for kept students, adds new students and drops removed ones", () => {
    const server: Marks = { a: L, b: null, c: P };
    const local: Marks = { a: P, b: A, gone: P };
    expect(mergeFresh(server, local, new Set(["b"]))).toEqual({ a: L, b: A, c: P });
  });

  it("keeps a kept student's local null (cleared) instead of the server value", () => {
    expect(mergeFresh({ a: P }, { a: null }, new Set(["a"]))).toEqual({ a: null });
  });

  it("does not mutate its inputs", () => {
    const server: Marks = { a: P };
    const local: Marks = { a: A };
    mergeFresh(server, local, new Set(["a"]));
    expect(server).toEqual({ a: P });
    expect(local).toEqual({ a: A });
  });
});

describe("boardReducer: saves", () => {
  it("applies a tap optimistically and counts it as pending", () => {
    const s = run(initBoardState({ a: null }), { type: "begin", studentId: "a", next: P, turn: 1 });
    expect(s.marks.a).toEqual(P);
    expect(s.confirmed.a).toBeNull();
    expect(pendingCount(s)).toBe(1);
    expect(saveChip(s)).toEqual({ kind: "saving", count: 1 });
  });

  it("confirms on success and reports saved", () => {
    const s = run(initBoardState({ a: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "settle", studentId: "a", next: P, turn: 1, ok: true });
    expect(s.confirmed.a).toEqual(P);
    expect(pendingCount(s)).toBe(0);
    expect(saveChip(s)).toEqual({ kind: "saved" });
  });

  it("is idle before any save", () => {
    expect(saveChip(initBoardState({ a: null }))).toEqual({ kind: "idle" });
  });

  it("reverts the latest failed save to the confirmed value and records the failure with the wanted mark", () => {
    const s = run(initBoardState({ a: L }),
      { type: "begin", studentId: "a", next: A, turn: 1 },
      { type: "settle", studentId: "a", next: A, turn: 1, ok: false, message: "Hết thời gian" });
    expect(s.marks.a).toEqual(L);
    expect(s.failures).toEqual([{ studentId: "a", mark: A, message: "Hết thời gian" }]);
    expect(saveChip(s)).toEqual({ kind: "idle" });
  });

  it("ignores a stale failure when a newer tap for the same student is in flight", () => {
    const s = run(initBoardState({ a: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "begin", studentId: "a", next: A, turn: 2 },
      { type: "settle", studentId: "a", next: P, turn: 1, ok: false, message: "x" });
    expect(s.marks.a).toEqual(A);
    expect(s.failures).toEqual([]);
    expect(pendingCount(s)).toBe(1);
  });

  it("an older success still updates the confirmed value but not the screen", () => {
    const s = run(initBoardState({ a: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "begin", studentId: "a", next: A, turn: 2 },
      { type: "settle", studentId: "a", next: P, turn: 1, ok: true },
      { type: "settle", studentId: "a", next: A, turn: 2, ok: false, message: "x" });
    expect(s.confirmed.a).toEqual(P);
    expect(s.marks.a).toEqual(P);
    expect(s.failures).toHaveLength(1);
  });

  it("keeps one failure per student, several students at once, and a new tap clears that student's failure", () => {
    const fail = (studentId: string, turn: number): BoardAction[] => [
      { type: "begin", studentId, next: P, turn },
      { type: "settle", studentId, next: P, turn, ok: false, message: "x" },
    ];
    let s = run(initBoardState({ a: null, b: null }), ...fail("a", 1), ...fail("b", 1), ...fail("a", 2));
    expect(s.failures.map((f) => f.studentId).sort()).toEqual(["a", "b"]);
    s = boardReducer(s, { type: "begin", studentId: "a", next: P, turn: 3 });
    expect(s.failures.map((f) => f.studentId)).toEqual(["b"]);
    s = boardReducer(s, { type: "dismiss", studentId: "b" });
    expect(s.failures).toEqual([]);
  });

  it("does not mutate the previous state", () => {
    const before = initBoardState({ a: null });
    boardReducer(before, { type: "begin", studentId: "a", next: P, turn: 1 });
    expect(before.marks.a).toBeNull();
    expect(pendingCount(before)).toBe(0);
  });
});

describe("boardReducer: fresh server data", () => {
  it("replaces marks with the server values when nothing is pending", () => {
    const s = run(initBoardState({ a: null, b: P }), { type: "syncRequested" }, { type: "fresh", server: { a: L, b: A } });
    expect(s.marks).toEqual({ a: L, b: A });
    expect(s.confirmed).toEqual({ a: L, b: A });
  });

  it("keeps a pending tap on screen while taking other students from the server", () => {
    const s = run(initBoardState({ a: null, b: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "syncRequested" },
      { type: "fresh", server: { a: null, b: L } });
    expect(s.marks).toEqual({ a: P, b: L });
  });

  it("keeps a tap that finished after the refresh was requested (the server copy may predate it)", () => {
    const s = run(initBoardState({ a: null }),
      { type: "syncRequested" },
      { type: "begin", studentId: "a", next: A, turn: 1 },
      { type: "settle", studentId: "a", next: A, turn: 1, ok: true },
      { type: "fresh", server: { a: null } });
    expect(s.marks.a).toEqual(A);
    expect(s.confirmed.a).toEqual(A);
  });

  it("takes the server value for a student tapped and saved before the refresh was requested", () => {
    const s = run(initBoardState({ a: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "settle", studentId: "a", next: P, turn: 1, ok: true },
      { type: "syncRequested" },
      { type: "fresh", server: { a: L } });
    expect(s.marks.a).toEqual(L);
  });

  it("a failed save after the merge reverts to the server value", () => {
    const s = run(initBoardState({ a: null }),
      { type: "syncRequested" },
      { type: "fresh", server: { a: L } },
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "settle", studentId: "a", next: P, turn: 1, ok: false, message: "x" });
    expect(s.marks.a).toEqual(L);
  });
});

describe("boardReducer: bulk writes", () => {
  it("sets server-confirmed marks for the given students only", () => {
    const s = run(initBoardState({ a: null, b: null, c: A }), { type: "bulkSet", studentIds: ["a", "c"], mark: P });
    expect(s.marks).toEqual({ a: P, b: null, c: P });
    expect(s.confirmed).toEqual({ a: P, b: null, c: P });
  });

  it("undo clears the given students but leaves a student with a pending tap alone", () => {
    const s = run(initBoardState({ a: P, b: P }),
      { type: "begin", studentId: "b", next: A, turn: 1 },
      { type: "bulkSet", studentIds: ["a", "b"], mark: null });
    expect(s.marks).toEqual({ a: null, b: A });
    expect(s.confirmed).toEqual({ a: null, b: null });
  });

  it("ignores unknown student ids", () => {
    const s = run(initBoardState({ a: null }), { type: "bulkSet", studentIds: ["zz"], mark: P });
    expect(s.marks).toEqual({ a: null });
  });
});

describe("boardReducer: timeouts and late results", () => {
  const timedOut = (state: BoardState, studentId: string, next: Mark, turn: number) =>
    run(state, { type: "begin", studentId, next, turn }, { type: "timeout", studentId, next, turn, message: "Mạng chậm" });

  it("a timeout reverts and records a failure but stays pending until the real result", () => {
    const s = timedOut(initBoardState({ a: null }), "a", P, 1);
    expect(s.marks.a).toBeNull();
    expect(s.failures).toEqual([{ studentId: "a", mark: P, message: "Mạng chậm" }]);
    expect(pendingCount(s)).toBe(1);
    expect(saveChip(s)).toEqual({ kind: "saving", count: 1 });
  });

  it("a late success restores the mark, confirms it and clears the failure", () => {
    const s = boardReducer(timedOut(initBoardState({ a: null }), "a", P, 1), { type: "late", studentId: "a", next: P, turn: 1, ok: true });
    expect(s.marks.a).toEqual(P);
    expect(s.confirmed.a).toEqual(P);
    expect(s.failures).toEqual([]);
    expect(pendingCount(s)).toBe(0);
    expect(saveChip(s)).toEqual({ kind: "saved" });
  });

  it("a late failure keeps the reverted state and the failure", () => {
    const s = boardReducer(timedOut(initBoardState({ a: L }), "a", P, 1), { type: "late", studentId: "a", next: P, turn: 1, ok: false });
    expect(s.marks.a).toEqual(L);
    expect(s.confirmed.a).toEqual(L);
    expect(s.failures).toHaveLength(1);
    expect(pendingCount(s)).toBe(0);
  });

  it("a late success under a newer tap only updates the confirmed value", () => {
    let s = timedOut(initBoardState({ a: null }), "a", P, 1);
    s = run(s, { type: "begin", studentId: "a", next: A, turn: 2 }, { type: "late", studentId: "a", next: P, turn: 1, ok: true });
    expect(s.marks.a).toEqual(A);
    expect(s.confirmed.a).toEqual(P);
    expect(pendingCount(s)).toBe(1);
  });

  it("a stale timeout (newer tap in flight) neither reverts nor reports", () => {
    const s = run(initBoardState({ a: null }),
      { type: "begin", studentId: "a", next: P, turn: 1 },
      { type: "begin", studentId: "a", next: A, turn: 2 },
      { type: "timeout", studentId: "a", next: P, turn: 1, message: "x" });
    expect(s.marks.a).toEqual(A);
    expect(s.failures).toEqual([]);
    expect(pendingCount(s)).toBe(2);
  });
});
