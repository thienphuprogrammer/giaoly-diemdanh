import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boardReducer, initBoardState, pendingCount, type BoardAction, type BoardState } from "./board-state";
import { runStatusSave, runBulk, TIMEOUT_ERROR } from "./board-save";
import type { Mark } from "./marks";

const P: Mark = { status: "present", reason: null };
type Result = { ok: true; data: unknown } | { ok: false; error: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Store tối giản giống useReducer để quan sát state sau mỗi lần dispatch. */
function store(initial: BoardState) {
  let state = initial;
  return { dispatch: (a: BoardAction) => { state = boardReducer(state, a); }, get: () => state };
}

describe("runStatusSave", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("in time: saves and settles", async () => {
    const st = store(initBoardState({ a: null }));
    await runStatusSave({ send: () => Promise.resolve({ ok: true, data: null } as Result), dispatch: st.dispatch, studentId: "a", next: P, turn: 1, ms: 1000 });
    expect(st.get().confirmed.a).toEqual(P);
    expect(pendingCount(st.get())).toBe(0);
  });

  it("server error in time: reverts with the server message", async () => {
    const st = store(initBoardState({ a: null }));
    await runStatusSave({ send: () => Promise.resolve({ ok: false, error: "Buổi nghỉ lễ" } as Result), dispatch: st.dispatch, studentId: "a", next: P, turn: 1, ms: 1000 });
    expect(st.get().marks.a).toBeNull();
    expect(st.get().failures[0]?.message).toBe("Buổi nghỉ lễ");
  });

  it("timeout then late success: shows the error meanwhile, stays pending, then restores the mark", async () => {
    const st = store(initBoardState({ a: null }));
    const d = deferred<Result>();
    const done = runStatusSave({ send: () => d.promise, dispatch: st.dispatch, studentId: "a", next: P, turn: 1, ms: 1000 });
    expect(st.get().marks.a).toEqual(P);
    await vi.advanceTimersByTimeAsync(1000);
    expect(st.get().marks.a).toBeNull();
    expect(st.get().failures[0]?.message).toBe(TIMEOUT_ERROR);
    expect(pendingCount(st.get())).toBe(1);
    d.resolve({ ok: true, data: null });
    await done;
    expect(st.get().marks.a).toEqual(P);
    expect(st.get().failures).toEqual([]);
    expect(pendingCount(st.get())).toBe(0);
  });

  it("timeout then late failure: keeps the reverted state and the error", async () => {
    const st = store(initBoardState({ a: null }));
    const d = deferred<Result>();
    const done = runStatusSave({ send: () => d.promise, dispatch: st.dispatch, studentId: "a", next: P, turn: 1, ms: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    d.reject(new Error("network"));
    await done;
    expect(st.get().marks.a).toBeNull();
    expect(st.get().failures).toHaveLength(1);
    expect(pendingCount(st.get())).toBe(0);
  });
});

describe("runBulk", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const handlers = () => {
    const log: string[] = [];
    return {
      log,
      on: {
        start: () => log.push("start"),
        end: () => log.push("end"),
        error: (m: string | null) => log.push(`error:${m}`),
        done: (d: unknown) => log.push(`done:${JSON.stringify(d)}`),
      },
    };
  };

  it("in time: done, then end", async () => {
    const h = handlers();
    await runBulk(() => Promise.resolve({ ok: true, data: 3 } as const), 1000, h.on);
    expect(h.log).toEqual(["start", "error:null", "done:3", "end"]);
  });

  it("server error: reports it", async () => {
    const h = handlers();
    await runBulk(() => Promise.resolve({ ok: false, error: "Không" } as const), 1000, h.on);
    expect(h.log).toEqual(["start", "error:null", "error:Không", "end"]);
  });

  it("timeout then late success: reports the timeout, stays busy, then applies the late data and clears the error", async () => {
    const h = handlers();
    const d = deferred<{ ok: true; data: number }>();
    const done = runBulk(() => d.promise, 1000, h.on);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.log).toEqual(["start", "error:null", `error:${TIMEOUT_ERROR}`]);
    d.resolve({ ok: true, data: 5 });
    await done;
    expect(h.log).toEqual(["start", "error:null", `error:${TIMEOUT_ERROR}`, "error:null", "done:5", "end"]);
  });

  it("timeout then late failure: keeps the timeout error and ends", async () => {
    const h = handlers();
    const d = deferred<{ ok: true; data: number }>();
    const done = runBulk(() => d.promise, 1000, h.on);
    await vi.advanceTimersByTimeAsync(1000);
    d.reject(new Error("x"));
    await done;
    expect(h.log).toEqual(["start", "error:null", `error:${TIMEOUT_ERROR}`, "end"]);
  });
});
