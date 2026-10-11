import { seatsOf } from "./layout";
import type { Assignment, Layout, Seat } from "./types";

export const seatKey = (seat: Seat): string => `${seat.benchId}:${seat.seatIndex}`;

type AssignResult = { ok: true; assignments: Assignment[] } | { ok: false; error: string };

export function assignStudent(
  layout: Layout,
  assignments: readonly Assignment[],
  seat: Seat,
  studentId: string,
): AssignResult {
  const target = seatKey(seat);
  if (!seatsOf(layout).some((s) => seatKey(s) === target)) return { ok: false, error: "Ghế không tồn tại trong sơ đồ" };
  const kept = assignments.filter((a) => a.studentId !== studentId && seatKey(a) !== target);
  return { ok: true, assignments: [...kept, { benchId: seat.benchId, seatIndex: seat.seatIndex, studentId }] };
}

export const unassignSeat = (assignments: readonly Assignment[], seat: Seat): Assignment[] =>
  assignments.filter((a) => seatKey(a) !== seatKey(seat));

export function pruneAssignments(layout: Layout, assignments: readonly Assignment[]): Assignment[] {
  const valid = new Set(seatsOf(layout).map(seatKey));
  return assignments.filter((a) => valid.has(seatKey(a)));
}

export function unseatedStudentIds(studentIds: readonly string[], assignments: readonly Assignment[]): string[] {
  const seated = new Set(assignments.map((a) => a.studentId));
  return studentIds.filter((id) => !seated.has(id));
}
