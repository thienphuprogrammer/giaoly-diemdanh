import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

const TONES = {
  error: { cls: "border-warn-alert/30 bg-warn-alert-tint text-warn-alert", icon: CircleAlert },
  warning: { cls: "border-warn-watch/30 bg-warn-watch-tint text-warn-watch", icon: TriangleAlert },
  success: { cls: "border-st-present/25 bg-st-present-tint text-st-present", icon: CircleCheck },
  info: { cls: "border-border bg-surface-muted text-ink-soft", icon: Info },
} as const;

/** Thông báo ngắn trong dòng. `role` giữ nguyên ngữ nghĩa cũ (alert cho lỗi, status cho kết quả). */
export function Notice({ tone, role, children, className = "" }: {
  tone: keyof typeof TONES; role?: "alert" | "status"; children: React.ReactNode; className?: string;
}) {
  const { cls, icon: Icon } = TONES[tone];
  return (
    <div role={role} className={`flex items-start gap-2 rounded-control border px-3 py-2.5 text-sm font-medium ${cls} ${className}`}>
      <Icon aria-hidden size={18} className="mt-px shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
