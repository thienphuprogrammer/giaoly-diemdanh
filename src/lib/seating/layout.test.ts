import { describe, expect, it } from "vitest";
import {
  LIMITS, addBench, addGap, addRow, canAddBench, canAddRow, defaultLayout, parseLayout,
  removeItem, removeRow, seatsOf, setBenchSeats,
} from "./layout";
import type { Layout } from "./types";

const base: Layout = [
  { id: "r1", items: [{ type: "bench", id: "b1", seats: 3 }, { type: "gap", id: "g1" }, { type: "bench", id: "b2", seats: 2 }] },
];

describe("layout operations", () => {
  it("never mutate their input", () => {
    const snapshot = structuredClone(base);
    addRow(base, "r2"); addBench(base, "r1", "b3"); addGap(base, "r1", "g2");
    setBenchSeats(base, "b1", 4); removeItem(base, "r1", "b1"); removeRow(base, "r1");
    expect(base).toEqual(snapshot);
  });

  it("adds a row, a 3-seat bench by default, and a gap", () => {
    const withRow = addRow(base, "r2");
    expect(withRow[1]).toEqual({ id: "r2", items: [] });
    expect(addBench(withRow, "r2", "b9")[1].items).toEqual([{ type: "bench", id: "b9", seats: 3 }]);
    expect(addGap(withRow, "r2", "g9")[1].items).toEqual([{ type: "gap", id: "g9" }]);
  });

  it("changes seats, removes an item and removes a row", () => {
    expect(setBenchSeats(base, "b2", 4)[0].items[2]).toEqual({ type: "bench", id: "b2", seats: 4 });
    expect(removeItem(base, "r1", "g1")[0].items.map((i) => i.id)).toEqual(["b1", "b2"]);
    expect(removeRow(base, "r1")).toEqual([]);
  });

  it("lists seats in reading order", () => {
    expect(seatsOf(base)).toEqual([
      { benchId: "b1", seatIndex: 0 }, { benchId: "b1", seatIndex: 1 }, { benchId: "b1", seatIndex: 2 },
      { benchId: "b2", seatIndex: 0 }, { benchId: "b2", seatIndex: 1 },
    ]);
  });

  it("builds a valid default layout with unique ids", () => {
    let n = 0;
    const layout = defaultLayout(() => `id${++n}`);
    expect(layout).toHaveLength(3);
    expect(parseLayout(layout).ok).toBe(true);
    expect(seatsOf(layout)).toHaveLength(18);
  });

  it("reports when more rows or benches can be added", () => {
    const rows = Array.from({ length: LIMITS.maxRows }, (_, i) => ({ id: `r${i}`, items: [] }));
    expect(canAddRow(rows)).toBe(false);
    expect(canAddRow(rows.slice(1))).toBe(true);
    const full: Layout = [{ id: "r", items: Array.from({ length: LIMITS.maxBenchesPerRow }, (_, i) => ({ type: "bench" as const, id: `b${i}`, seats: 2 })) }];
    expect(canAddBench(full, "r")).toBe(false);
    expect(canAddBench(base, "r1")).toBe(true);
  });
});

describe("parseLayout", () => {
  it("accepts a valid layout and an empty one", () => {
    expect(parseLayout(base)).toEqual({ ok: true, layout: base });
    expect(parseLayout([]).ok).toBe(true);
  });

  it("rejects benches with fewer than 2 or more than 4 seats", () => {
    for (const seats of [1, 5, 2.5]) {
      const r = parseLayout([{ id: "r", items: [{ type: "bench", id: "b", seats }] }]);
      expect(r).toEqual({ ok: false, error: "Mỗi băng có từ 2 đến 4 ghế" });
    }
  });

  it("rejects too many rows and too many benches in a row", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, items: [] }));
    expect(parseLayout(rows)).toEqual({ ok: false, error: "Tối đa 12 hàng" });
    const benches = Array.from({ length: 9 }, (_, i) => ({ type: "bench", id: `b${i}`, seats: 2 }));
    expect(parseLayout([{ id: "r", items: benches }])).toEqual({ ok: false, error: "Mỗi hàng tối đa 8 băng" });
  });

  it("rejects duplicate ids and malformed input", () => {
    const dup = [{ id: "r", items: [{ type: "bench", id: "x", seats: 2 }, { type: "gap", id: "x" }] }];
    expect(parseLayout(dup)).toEqual({ ok: false, error: "Mã băng hoặc hàng bị trùng" });
    expect(parseLayout("nope")).toEqual({ ok: false, error: "Sơ đồ không hợp lệ" });
    expect(parseLayout([{ id: "r", items: [{ type: "table" }] }])).toEqual({ ok: false, error: "Sơ đồ không hợp lệ" });
  });
});
