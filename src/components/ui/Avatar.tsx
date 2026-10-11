import { shortName } from "@/lib/students/short-name";

/** Vòng tròn chữ cái đầu của tên gọi (từ cuối của họ tên). */
export function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  const initial = shortName(name).charAt(0).toLocaleUpperCase("vi");
  return (
    <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-base font-semibold ${muted ? "bg-surface-muted text-ink-muted" : "bg-action-tint text-action"}`}>
      {initial}
    </span>
  );
}
