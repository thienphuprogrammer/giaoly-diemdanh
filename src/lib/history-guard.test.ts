import { describe, expect, it } from "vitest";
import { armGuard, guardClick, guardPop, guardLeave, initialHistoryGuard, mountGuard, type HistoryGuardState } from "./history-guard";

const armed: HistoryGuardState = { armed: true, exiting: null };

describe("armGuard", () => {
  it("pushes one sentinel entry when something becomes unsaved", () => {
    expect(armGuard(initialHistoryGuard, true)).toEqual({ state: armed, effect: { kind: "push" } });
  });

  it("does nothing when already armed, nothing is unsaved, or the page is leaving", () => {
    expect(armGuard(armed, true).effect).toEqual({ kind: "none" });
    expect(armGuard(initialHistoryGuard, false).effect).toEqual({ kind: "none" });
    expect(armGuard({ armed: false, exiting: { kind: "href", href: "/x" } }, true).effect).toEqual({ kind: "none" });
  });

  it("keeps the sentinel when everything got saved (no history traversal racing with navigation)", () => {
    expect(armGuard(armed, false)).toEqual({ state: armed, effect: { kind: "none" } });
  });
});

describe("guardPop (Back pressed)", () => {
  it("re-arms and asks when there is still unsaved work", () => {
    expect(guardPop(armed, true)).toEqual({ state: armed, effect: { kind: "prompt" } });
  });

  it("passes through to the real previous page when everything is saved", () => {
    expect(guardPop(armed, false)).toEqual({ state: initialHistoryGuard, effect: { kind: "back" } });
  });

  it("ignores pops that are not ours", () => {
    expect(guardPop(initialHistoryGuard, true).effect).toEqual({ kind: "none" });
  });

  it("finishes a pending link navigation once the sentinel has been popped", () => {
    const leaving: HistoryGuardState = { armed: false, exiting: { kind: "href", href: "/lop/1" } };
    expect(guardPop(leaving, true)).toEqual({ state: initialHistoryGuard, effect: { kind: "navigate", href: "/lop/1" } });
  });

  it("does nothing more while leaving by Back", () => {
    const leaving: HistoryGuardState = { armed: false, exiting: { kind: "back" } };
    expect(guardPop(leaving, true)).toEqual({ state: leaving, effect: { kind: "none" } });
  });
});

describe("guardLeave (user chose to leave)", () => {
  it("navigates straight away when no sentinel is in history", () => {
    expect(guardLeave(initialHistoryGuard, { kind: "href", href: "/a" })).toEqual({ state: initialHistoryGuard, effect: { kind: "navigate", href: "/a" } });
    expect(guardLeave(initialHistoryGuard, { kind: "back" })).toEqual({ state: { armed: false, exiting: { kind: "back" } }, effect: { kind: "back" } });
  });

  it("pops the sentinel first so the scanner does not stay in history", () => {
    expect(guardLeave(armed, { kind: "href", href: "/a" })).toEqual({ state: { armed: false, exiting: { kind: "href", href: "/a" } }, effect: { kind: "back" } });
  });

  it("goes back past the sentinel and the page itself for Back", () => {
    expect(guardLeave(armed, { kind: "back" })).toEqual({ state: { armed: false, exiting: { kind: "back" } }, effect: { kind: "go", delta: -2 } });
  });
});

describe("mountGuard (page loaded on a sentinel entry, e.g. after reload)", () => {
  it("starts armed without pushing another entry, so entries do not accumulate", () => {
    const s = mountGuard(true);
    expect(s).toEqual(armed);
    expect(armGuard(s, true).effect).toEqual({ kind: "none" });
    expect(guardPop(s, false).effect).toEqual({ kind: "back" }); // Back is not a dead press
  });

  it("starts unarmed on a normal entry", () => {
    expect(mountGuard(false)).toEqual(initialHistoryGuard);
  });
});

describe("guardClick (in-app link clicked)", () => {
  it("asks while something is unsaved", () => {
    expect(guardClick(armed, true)).toBe("prompt");
    expect(guardClick(initialHistoryGuard, true)).toBe("prompt");
  });

  it("leaves through the sentinel when saved but still armed (removes the stale same-URL entry)", () => {
    expect(guardClick(armed, false)).toBe("leave");
    const step = guardLeave(armed, { kind: "href", href: "/lop/1/thong-ke" });
    expect(step.effect).toEqual({ kind: "back" });
    expect(guardPop(step.state, false)).toEqual({ state: initialHistoryGuard, effect: { kind: "navigate", href: "/lop/1/thong-ke" } });
  });

  it("lets the browser handle it when not armed or already leaving", () => {
    expect(guardClick(initialHistoryGuard, false)).toBe("ignore");
    expect(guardClick({ armed: false, exiting: { kind: "back" } }, true)).toBe("ignore");
  });
});

describe("hard navigation (full page load, e.g. re-login)", () => {
  it("pops the sentinel first, then loads the page", () => {
    const step = guardLeave(armed, { kind: "href", href: "/login", hard: true });
    expect(step.effect).toEqual({ kind: "back" });
    expect(guardPop(step.state, true).effect).toEqual({ kind: "navigate", href: "/login", hard: true });
  });

  it("loads straight away when not armed", () => {
    expect(guardLeave(initialHistoryGuard, { kind: "href", href: "/login", hard: true }).effect).toEqual({ kind: "navigate", href: "/login", hard: true });
  });
});
