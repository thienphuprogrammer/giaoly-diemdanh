export interface BenchItem { type: "bench"; id: string; seats: number }
export interface GapItem { type: "gap"; id: string }
export type LayoutItem = BenchItem | GapItem;
export interface LayoutRow { id: string; items: LayoutItem[] }
export type Layout = LayoutRow[];

export interface Seat { benchId: string; seatIndex: number }
export interface Assignment extends Seat { studentId: string }
