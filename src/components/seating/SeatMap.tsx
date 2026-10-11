import type { Layout, Seat } from "@/lib/seating/types";

/**
 * Sơ đồ lớp: mỗi hàng là một dãy băng ghế (khung bo tròn nền xám nhạt, có số băng),
 * lối đi là khoảng trống có vạch đứt. Chỉ cuộn ngang bên trong khung này, không cuộn cả trang.
 */
export function SeatMap({ layout, renderSeat }: { layout: Layout; renderSeat: (seat: Seat) => React.ReactNode }) {
  if (layout.length === 0) return <p className="p-4 text-ink-soft">Sơ đồ chưa có hàng nào.</p>;
  const benchNo = new Map(layout.flatMap((r) => r.items).filter((i) => i.type === "bench").map((b, i) => [b.id, i + 1]));
  return (
    <div className="scroll-shadows overflow-x-auto px-3 pb-3 pt-5">
      <div className="mx-auto flex w-max flex-col gap-6">
        {layout.map((row, index) => (
          <div key={row.id} role="group" aria-label={`Hàng ${index + 1}`} className="flex items-stretch gap-2">
            {row.items.map((item) => {
              if (item.type === "gap") {
                return (
                  <div key={item.id} aria-hidden className="flex w-6 shrink-0 justify-center">
                    <span className="h-full border-l-2 border-dashed border-border" />
                  </div>
                );
              }
              return (
                <div key={item.id} className="relative rounded-card border border-border bg-surface-muted p-1.5 pt-3">
                  <span aria-hidden className="absolute -top-2.5 left-2 rounded-full bg-surface px-1.5 font-display text-xs font-medium leading-5 text-ink-muted">
                    Băng {benchNo.get(item.id)}
                  </span>
                  <div className="flex gap-1.5">
                    {Array.from({ length: item.seats }, (_, seatIndex) => (
                      <div key={seatIndex}>{renderSeat({ benchId: item.id, seatIndex })}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
