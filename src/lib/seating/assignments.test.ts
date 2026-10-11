import { describe, expect, it } from "vitest";
import { assignStudent, pruneAssignments, seatKey, unassignSeat, unseatedStudentIds } from "./assignments";
import type { Assignment, Layout } from "./types";

const layout: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }, { type: "bench", id: "b2", seats: 2 }] }];
const s = (benchId: string, seatIndex: number) => ({ benchId, seatIndex });

describe("assignStudent", () => {
  it("seats a student on a valid seat", () => {
    const r = assignStudent(layout, [], s("b1", 0), "an");
    expect(r).toEqual({ ok: true, assignments: [{ benchId: "b1", seatIndex: 0, studentId: "an" }] });
  });

  it("moves a student who is already seated", () => {
    const start: Assignment[] = [{ ...s("b1", 0), studentId: "an" }];
    const r = assignStudent(layout, start, s("b2", 1), "an");
    expect(r).toEqual({ ok: true, assignments: [{ ...s("b2", 1), studentId: "an" }] });
  });

  it("replaces the occupant, who becomes unseated", () => {
    const start: Assignment[] = [{ ...s("b1", 0), studentId: "an" }];
    const r = assignStudent(layout, start, s("b1", 0), "binh");
    expect(r).toEqual({ ok: true, assignments: [{ ...s("b1", 0), studentId: "binh" }] });
  });

  it("rejects seats that do not exist and does not mutate its input", () => {
    const start: Assignment[] = Object.freeze([{ ...s("b1", 0), studentId: "an" }]) as Assignment[];
    expect(assignStudent(layout, start, s("b1", 2), "binh")).toEqual({ ok: false, error: "Ghế không tồn tại trong sơ đồ" });
    expect(assignStudent(layout, start, s("zzz", 0), "binh").ok).toBe(false);
    expect(start).toHaveLength(1);
  });
});

describe("unassignSeat / pruneAssignments / unseatedStudentIds", () => {
  const start: Assignment[] = [
    { ...s("b1", 0), studentId: "an" },
    { ...s("b2", 1), studentId: "binh" },
  ];

  it("unassigns one seat", () => {
    expect(unassignSeat(start, s("b1", 0))).toEqual([{ ...s("b2", 1), studentId: "binh" }]);
  });

  it("prunes assignments of removed benches and of seats that no longer exist", () => {
    const shrunk: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }] }];
    expect(pruneAssignments(shrunk, start)).toEqual([{ ...s("b1", 0), studentId: "an" }]);
    const fewerSeats: Layout = [{ id: "r1", items: [{ type: "bench", id: "b1", seats: 2 }, { type: "bench", id: "b2", seats: 2 }] }];
    const high: Assignment[] = [{ ...s("b2", 3), studentId: "chi" }];
    expect(pruneAssignments(fewerSeats, high)).toEqual([]);
  });

  it("lists students without a seat", () => {
    expect(unseatedStudentIds(["an", "binh", "chi"], start)).toEqual(["chi"]);
  });

  it("builds stable seat keys", () => expect(seatKey(s("b1", 2))).toBe("b1:2"));
});
