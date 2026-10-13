import Link from "next/link";

/** Chọn học kỳ bằng `?termId=` (dùng chung cho thống kê lớp và báo cáo khối). */
export function TermTabs({ terms, currentId, preserveParams = {} }: { terms: readonly { id: string; name: string }[]; currentId: string; preserveParams?: Record<string, string> }) {
  if (terms.length <= 1) return null;
  return (
    <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Học kỳ">
      {terms.map((t) => (
        <Link key={t.id} href={`?${new URLSearchParams({ ...preserveParams, termId: t.id })}`} aria-current={t.id === currentId ? "page" : undefined}
          className={`flex h-11 shrink-0 items-center rounded-full border px-4 font-display text-sm font-medium transition-colors ${t.id === currentId ? "border-action bg-action text-on-action" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}>
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
