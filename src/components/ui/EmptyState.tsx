import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children, action }: {
  icon: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong bg-surface px-6 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-action-tint text-action">
        <Icon aria-hidden size={24} />
      </span>
      <p className="font-display text-lg font-medium text-ink">{title}</p>
      {children && <div className="max-w-xs text-sm text-ink-soft">{children}</div>}
      {action}
    </div>
  );
}
