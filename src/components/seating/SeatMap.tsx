import type { Layout, Seat } from "@/lib/seating/types";

export function SeatMap({ layout, renderSeat }: { layout: Layout; renderSeat: (seat: Seat) => React.ReactNode }) {
  if (layout.length === 0) return <p className="text-ink-soft">Sơ đồ chưa có hàng nào.</p>;
  return (
    <div className="flex flex-col gap-3 overflow-x-auto pb-2">
      {layout.map((row, index) => (
        <div key={row.id} role="group" aria-label={`Hàng ${index + 1}`} className="flex min-w-max items-stretch gap-2">
          {row.items.map((item) =>
            item.type === "gap" ? (
              <div key={item.id} aria-hidden className="w-6 shrink-0" />
            ) : (
              <div key={item.id} className="flex gap-1 rounded-2xl border border-line bg-card p-1.5 shadow-sm">
                {Array.from({ length: item.seats }, (_, seatIndex) => (
                  <div key={seatIndex}>{renderSeat({ benchId: item.id, seatIndex })}</div>
                ))}
              </div>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
