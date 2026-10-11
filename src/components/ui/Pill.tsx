import { Eye, TriangleAlert, type LucideIcon } from "lucide-react";
import { STATUS_META, type StatusKey } from "./status";

const BASE = "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-display text-xs font-medium leading-tight";

const TONES = {
  neutral: "border-border bg-surface-muted text-ink-soft",
  action: "border-action/25 bg-action-tint text-action",
  watch: "border-warn-watch/30 bg-warn-watch-tint text-warn-watch",
  alert: "border-warn-alert/30 bg-warn-alert-tint text-warn-alert",
} as const;

export function Pill({ tone = "neutral", icon: Icon, children, className = "" }: {
  tone?: keyof typeof TONES; icon?: LucideIcon; children: React.ReactNode; className?: string;
}) {
  return (
    <span className={`${BASE} ${TONES[tone]} ${className}`}>
      {Icon && <Icon aria-hidden size={14} strokeWidth={2.25} className="shrink-0" />}
      {children}
    </span>
  );
}

/** Trạng thái điểm danh: luôn có biểu tượng + chữ, không chỉ dựa vào màu. */
export function StatusPill({ status, label, className = "" }: { status: StatusKey; label?: string; className?: string }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`${BASE} ${meta.tint} ${className}`}>
      <Icon aria-hidden size={14} strokeWidth={2.5} className="shrink-0" />
      {label ?? meta.short}
    </span>
  );
}

/** Mức cảnh báo vắng: "warning" (đỏ) hoặc "watch" (cam). */
export function WarningPill({ level, children, className = "" }: { level: "warning" | "watch"; children: React.ReactNode; className?: string }) {
  return <Pill tone={level === "warning" ? "alert" : "watch"} icon={TriangleAlert} className={className}>{children}</Pill>;
}

export function ReadOnlyPill() {
  return <Pill icon={Eye}>Chỉ xem</Pill>;
}
