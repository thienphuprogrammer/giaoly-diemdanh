import type { Layout } from "@/lib/seating/types";

const SEAT = 9;
const SEAT_GAP = 2;
const PAD = 3;
const BENCH_GAP = 4;
const AISLE = 8;
const ROW_GAP = 6;
const BOARD_H = 5;
const BOARD_GAP = 8;
const MARGIN = 4;

const benchWidth = (seats: number) => seats * SEAT + (seats - 1) * SEAT_GAP + PAD * 2;
const itemWidth = (item: Layout[number]["items"][number]) => (item.type === "gap" ? AISLE : benchWidth(item.seats));
const rowWidth = (row: Layout[number]) => row.items.reduce((w, i, k) => w + itemWidth(i) + (k > 0 ? BENCH_GAP : 0), 0);

/** Hình thu nhỏ của bố cục: bảng ở trên (phía trước lớp), mỗi băng là một khung với các ghế. Chỉ trang trí. */
export function TemplateThumb({ layout, className = "" }: { layout: Layout; className?: string }) {
  const inner = Math.max(0, ...layout.map(rowWidth));
  const width = inner + MARGIN * 2;
  const rowH = SEAT + PAD * 2;
  const height = MARGIN * 2 + BOARD_H + BOARD_GAP + layout.length * rowH + Math.max(0, layout.length - 1) * ROW_GAP;
  const boardW = Math.max(24, inner * 0.4);

  return (
    <svg aria-hidden focusable="false" viewBox={`0 0 ${width} ${height}`} className={className}>
      <rect x={(width - boardW) / 2} y={MARGIN} width={boardW} height={BOARD_H} rx={2} className="fill-ink-muted" />
      {layout.map((row, r) => {
        const y = MARGIN + BOARD_H + BOARD_GAP + r * (rowH + ROW_GAP);
        let x = (width - rowWidth(row)) / 2;
        return (
          <g key={row.id}>
            {row.items.map((item) => {
              const x0 = x;
              x += itemWidth(item) + BENCH_GAP;
              if (item.type === "gap") return null;
              return (
                <g key={item.id}>
                  <rect x={x0} y={y} width={benchWidth(item.seats)} height={rowH} rx={3} className="fill-action-tint stroke-border-strong" strokeWidth={0.75} />
                  {Array.from({ length: item.seats }, (_, s) => (
                    <rect key={s} x={x0 + PAD + s * (SEAT + SEAT_GAP)} y={y + PAD} width={SEAT} height={SEAT} rx={2} className="fill-action" />
                  ))}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
