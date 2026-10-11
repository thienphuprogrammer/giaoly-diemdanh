import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackSend, type SendOutcome } from "./track-send";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recorder() {
  const calls: Array<[string, SendOutcome<number>?]> = [];
  return {
    calls,
    on: {
      settle: (o: SendOutcome<number>) => calls.push(["settle", o]),
      timeout: () => calls.push(["timeout"]),
      late: (o: SendOutcome<number>) => calls.push(["late", o]),
    },
  };
}

describe("trackSend", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("settles once with the value when the send finishes in time, and clears its timer", async () => {
    const r = recorder();
    await trackSend(Promise.resolve(7), 1000, r.on);
    expect(r.calls).toEqual([["settle", { ok: true, value: 7 }]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles with the error when the send rejects in time", async () => {
    const r = recorder();
    const boom = new Error("boom");
    await trackSend(Promise.reject(boom), 1000, r.on);
    expect(r.calls).toEqual([["settle", { ok: false, error: boom }]]);
  });

  it("times out, then reports a late success from the same send", async () => {
    const d = deferred<number>();
    const r = recorder();
    const done = trackSend(d.promise, 1000, r.on);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.calls).toEqual([["timeout"]]);
    d.resolve(9);
    await done;
    expect(r.calls).toEqual([["timeout"], ["late", { ok: true, value: 9 }]]);
  });

  it("times out, then reports a late failure", async () => {
    const d = deferred<number>();
    const r = recorder();
    const done = trackSend(d.promise, 1000, r.on);
    await vi.advanceTimersByTimeAsync(1500);
    const err = new Error("x");
    d.reject(err);
    await done;
    expect(r.calls).toEqual([["timeout"], ["late", { ok: false, error: err }]]);
  });
});
