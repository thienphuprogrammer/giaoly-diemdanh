import { z } from "zod";
import type { Layout, LayoutRow, Seat } from "./types";

export const LIMITS = { minSeats: 2, maxSeats: 4, maxRows: 12, maxBenchesPerRow: 8, maxItemsPerRow: 16 } as const;

const MSG = {
  seats: "Mỗi băng có từ 2 đến 4 ghế",
  rows: "Tối đa 12 hàng",
  benches: "Mỗi hàng tối đa 8 băng",
  items: "Mỗi hàng tối đa 16 mục",
  duplicate: "Mã băng hoặc hàng bị trùng",
  invalid: "Sơ đồ không hợp lệ",
} as const;
const KNOWN = new Set<string>(Object.values(MSG));

const benchSchema = z.object({
  type: z.literal("bench"),
  id: z.string().min(1),
  seats: z.number().int(MSG.seats).min(LIMITS.minSeats, MSG.seats).max(LIMITS.maxSeats, MSG.seats),
});
const gapSchema = z.object({ type: z.literal("gap"), id: z.string().min(1) });
const rowSchema = z.object({
  id: z.string().min(1),
  items: z.array(z.discriminatedUnion("type", [benchSchema, gapSchema])).max(LIMITS.maxItemsPerRow, MSG.items),
});
const layoutSchema = z.array(rowSchema).max(LIMITS.maxRows, MSG.rows);

type ParseResult = { ok: true; layout: Layout } | { ok: false; error: string };

export function parseLayout(input: unknown): ParseResult {
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? MSG.invalid;
    return { ok: false, error: KNOWN.has(message) ? message : MSG.invalid };
  }
  const layout: Layout = parsed.data;
  const ids = new Set<string>();
  for (const row of layout) {
    if (row.items.filter((i) => i.type === "bench").length > LIMITS.maxBenchesPerRow) return { ok: false, error: MSG.benches };
    for (const id of [row.id, ...row.items.map((i) => i.id)]) {
      if (ids.has(id)) return { ok: false, error: MSG.duplicate };
      ids.add(id);
    }
  }
  return { ok: true, layout };
}

const mapRow = (layout: Layout, rowId: string, fn: (row: LayoutRow) => LayoutRow): Layout =>
  layout.map((row) => (row.id === rowId ? fn(row) : row));

export const addRow = (layout: Layout, rowId: string): Layout => [...layout, { id: rowId, items: [] }];
export const removeRow = (layout: Layout, rowId: string): Layout => layout.filter((r) => r.id !== rowId);

export const addBench = (layout: Layout, rowId: string, benchId: string, seats = 3): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: [...row.items, { type: "bench", id: benchId, seats }] }));

export const addGap = (layout: Layout, rowId: string, gapId: string): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: [...row.items, { type: "gap", id: gapId }] }));

export const removeItem = (layout: Layout, rowId: string, itemId: string): Layout =>
  mapRow(layout, rowId, (row) => ({ ...row, items: row.items.filter((i) => i.id !== itemId) }));

export const setBenchSeats = (layout: Layout, benchId: string, seats: number): Layout =>
  layout.map((row) => ({
    ...row,
    items: row.items.map((i) => (i.type === "bench" && i.id === benchId ? { ...i, seats } : i)),
  }));

export const canAddRow = (layout: Layout): boolean => layout.length < LIMITS.maxRows;

export function canAddBench(layout: Layout, rowId: string): boolean {
  const row = layout.find((r) => r.id === rowId);
  return !!row && row.items.filter((i) => i.type === "bench").length < LIMITS.maxBenchesPerRow && row.items.length < LIMITS.maxItemsPerRow;
}

export function seatsOf(layout: Layout): Seat[] {
  return layout.flatMap((row) =>
    row.items.flatMap((item) =>
      item.type === "bench" ? Array.from({ length: item.seats }, (_, seatIndex) => ({ benchId: item.id, seatIndex })) : [],
    ),
  );
}

export function defaultLayout(newId: () => string): Layout {
  return Array.from({ length: 3 }, () => ({
    id: newId(),
    items: [
      { type: "bench" as const, id: newId(), seats: 3 },
      { type: "gap" as const, id: newId() },
      { type: "bench" as const, id: newId(), seats: 3 },
    ],
  }));
}
