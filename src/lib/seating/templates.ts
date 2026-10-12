import type { Layout } from "./types";

/** Một mục trong hàng: số ghế của băng (2–4) hoặc "g" cho lối đi. */
type Cell = 2 | 3 | 4 | "g";

export interface SeatingTemplate {
  id: string;
  name: string;
  description: string;
  /** Gợi ý sĩ số, ví dụ "lớp 28–36 em". */
  classSize: string;
  /** Các hàng từ trên (gần bảng) xuống dưới; mỗi hàng liệt kê trái -> phải. */
  rows: readonly (readonly Cell[])[];
}

const repeat = <T,>(n: number, row: T): T[] => Array.from({ length: n }, () => row);

export const TEMPLATES: readonly SeatingTemplate[] = [
  {
    id: "lop-nho-2-day",
    name: "Lớp nhỏ 2 dãy",
    description: "Gần bảng, dễ kèm từng em",
    classSize: "lớp 15–24 em",
    rows: repeat(4, [3, "g", 3] as const),
  },
  {
    id: "vua-3-day",
    name: "Vừa 3 dãy",
    description: "Hai lối đi, GLV đi được giữa lớp",
    classSize: "lớp 28–36 em",
    rows: repeat(4, [3, "g", 3, "g", 3] as const),
  },
  {
    id: "hang-dau-nho",
    name: "Hàng đầu nhỏ",
    description: "Em nhỏ hoặc cần chú ý ngồi hàng đầu",
    classSize: "lớp 36–44 em",
    rows: [[2, 2, 2, 2], ...repeat(3, [3, 3, 3, 3] as const)],
  },
  {
    id: "chu-u",
    name: "Chữ U",
    description: "Thảo luận, nhìn thấy nhau, GLV đứng giữa",
    classSize: "lớp 20–24 em",
    rows: [...repeat(3, [2, "g", "g", 2] as const), [3, 3, 3, 3]],
  },
  {
    id: "nhom-bang-dai",
    name: "Nhóm băng dài",
    description: "Hoạt động nhóm, ít hàng, lối đi rộng",
    classSize: "lớp 20–24 em",
    rows: repeat(2, [4, "g", 4, "g", 4] as const),
  },
  {
    id: "truyen-thong-3-day",
    name: "Truyền thống 3 dãy",
    description: "Dãy giữa băng 4, hai bên băng 3",
    classSize: "lớp 40–50 em",
    rows: repeat(5, [3, "g", 4, "g", 3] as const),
  },
];

export const templateCapacity = (t: SeatingTemplate): number =>
  t.rows.reduce((sum, row) => sum + row.reduce<number>((s, c) => s + (c === "g" ? 0 : c), 0), 0);

/** Tạo bố cục mới (không dùng chung đối tượng) từ mẫu; `null` nếu không có mẫu đó. */
export function buildTemplateLayout(templateId: string, idGen: () => string): Layout | null {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return null;
  return template.rows.map((row) => ({
    id: idGen(),
    items: row.map((cell) => (cell === "g" ? { type: "gap" as const, id: idGen() } : { type: "bench" as const, id: idGen(), seats: cell })),
  }));
}

export interface CapacityStatus {
  fits: boolean;
  /** Số chỗ dư (khi đủ) hoặc thiếu (khi không đủ); luôn >= 0. */
  delta: number;
  label: string;
  badge: string;
}

export function capacityStatus(capacity: number, studentCount: number): CapacityStatus {
  const diff = capacity - studentCount;
  if (diff >= 0) return { fits: true, delta: diff, label: `đủ chỗ, dư ${diff}`, badge: diff === 0 ? "Vừa đủ chỗ" : `Dư ${diff} chỗ` };
  const short = -diff;
  return { fits: false, delta: short, label: `thiếu ${short} chỗ`, badge: `Thiếu ${short} chỗ` };
}
