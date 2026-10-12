import { Check, Church, X } from "lucide-react";
import { Pill, WarningPill } from "@/components/ui/Pill";
import { dateLabel } from "@/lib/date-label";
import type { StudentMass } from "@/server/services/student-profile";

/** Khối "Đi lễ" của hồ sơ em (spec §1b): tính riêng với chuyên cần buổi học, có ngưỡng cảnh báo của khối. */
export function MassBlock({ mass, termName }: { mass: StudentMass; termName: string }) {
  const counts = [
    { label: "Đi lễ", value: mass.attended, alert: false },
    { label: "Vắng lễ", value: mass.missed, alert: mass.missed > 0 },
    { label: "Tuần đã ghi", value: mass.counted, alert: false },
  ];
  return (
    <section aria-labelledby="mass-heading" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mass-heading" className="flex items-center gap-2 text-base font-semibold">
          <Church aria-hidden size={18} className="text-ink-muted" />Đi lễ {termName}
        </h3>
        {mass.warning && <WarningPill level="warning">Cảnh báo · vắng lễ {mass.missed} tuần</WarningPill>}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {counts.map((c) => (
          <div key={c.label} className="flex flex-col-reverse items-center rounded-control bg-surface-muted py-2">
            <dd className={`font-display text-lg font-semibold tabular-nums ${c.alert ? "text-st-unexcused" : "text-ink"}`}>{c.value}</dd>
            <dt className="text-center text-xs text-ink-soft">{c.label}</dt>
          </div>
        ))}
      </dl>
      <p className="text-xs text-ink-muted">
        Cảnh báo khi vắng lễ từ {mass.threshold} tuần trong học kỳ. Chỉ tính tuần lớp đã ghi đi lễ, từ buổi đầu tiên em có tên ở lớp.
      </p>
      {mass.weeks.length === 0 ? (
        <p className="text-sm text-ink-soft">Chưa có tuần đi lễ nào được ghi cho em trong học kỳ này.</p>
      ) : (
        <ul aria-label="Các tuần đi lễ đã ghi" className="-mx-4 divide-y divide-border border-t border-border">
          {mass.weeks.map((w) => (
            <li key={w.sessionId} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className="font-medium">{dateLabel(w.heldOn)}</span>
              {w.attended
                ? <Pill tone="action" icon={Check}>Đi lễ</Pill>
                : <Pill tone="alert" icon={X}>Vắng lễ</Pill>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
