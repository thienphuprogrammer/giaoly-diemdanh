export function SectionHeader({ title, description, action, as: Tag = "h2", id }: {
  title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; as?: "h1" | "h2" | "h3"; id?: string;
}) {
  const size = Tag === "h1" ? "text-2xl font-semibold" : Tag === "h2" ? "text-xl font-semibold" : "text-base font-semibold";
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <Tag id={id} className={`${size} text-ink`}>{title}</Tag>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
