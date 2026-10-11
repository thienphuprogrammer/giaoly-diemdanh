import { describe, expect, it } from "vitest";
import { countMarked, createSequencer, fillPresent, initialMarks, settleSave, type Mark, type Marks } from "./marks";

describe("initialMarks", () => {
  it("maps students to marks or null", () => {
    const m = initialMarks([
      { id: "a", status: "late", reason: "xe hư" },
      { id: "b", status: null, reason: null },
    ]);
    expect(m).toEqual({ a: { status: "late", reason: "xe hư" }, b: null });
  });
});

describe("fillPresent", () => {
  it("only fills unmarked students and does not mutate", () => {
    const before: Record<string, Mark> = { a: { status: "absent_unexcused", reason: null }, b: null };
    const after = fillPresent(before);
    expect(after.a?.status).toBe("absent_unexcused");
    expect(after.b).toEqual({ status: "present", reason: null });
    expect(before.b).toBeNull();
  });
});

describe("countMarked", () => {
  it("counts non-null marks", () => {
    expect(countMarked({ a: { status: "present", reason: null }, b: null })).toBe(1);
  });
});

describe("createSequencer", () => {
  it("treats only the newest begin per key as latest", () => {
    const s = createSequencer();
    const first = s.begin("a");
    const second = s.begin("a");
    const other = s.begin("b");
    expect(s.isLatest("a", first)).toBe(false);
    expect(s.isLatest("a", second)).toBe(true);
    expect(s.isLatest("b", other)).toBe(true);
  });
});

describe("settleSave", () => {
  const present: Mark = { status: "present", reason: null };
  const absent: Mark = { status: "absent_unexcused", reason: null };

  it("records confirmation for stale successes, then reverts a failed latest save to it", () => {
    const start: Marks = { a: null };
    const afterSave1 = settleSave({ confirmed: start, studentId: "a", next: present, saved: true, isLatest: false });
    expect(afterSave1.confirmed.a).toEqual(present);
    expect(afterSave1.revertTo).toBeUndefined();
    const afterSave2 = settleSave({ confirmed: afterSave1.confirmed, studentId: "a", next: absent, saved: false, isLatest: true });
    expect(afterSave2.revertTo).toEqual(present);
    expect(afterSave2.confirmed.a).toEqual(present);
  });

  it("does not revert when a stale save fails", () => {
    const r = settleSave({ confirmed: { a: present }, studentId: "a", next: absent, saved: false, isLatest: false });
    expect(r.revertTo).toBeUndefined();
  });

  it("reverts to null when nothing was confirmed", () => {
    const r = settleSave({ confirmed: {}, studentId: "a", next: present, saved: false, isLatest: true });
    expect(r.revertTo).toBeNull();
  });
});
