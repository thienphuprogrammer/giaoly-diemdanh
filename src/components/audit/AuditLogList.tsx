import { AlarmClock, ArrowUpRight, CalendarDays, CalendarRange, ClipboardCheck, LayoutGrid, ScanLine, SlidersHorizontal, UsersRound, type LucideIcon } from "lucide-react";
import { dateLabel } from "@/lib/date-label";

/** Phần của `AuditLogItem` mà danh sách cần: toàn chuỗi đã dựng sẵn, không có `summary` thô nào đi qua đây. */
export interface LogLine {
  id: string;
  source: string;
  at: Date;
  day: string;
  actor: string;
  what: string;
  entity: string;
}

const ICONS: Record<string, LucideIcon> = {
  attendance: ClipboardCheck,
  student: UsersRound,
  seating_plan: LayoutGrid,
  session: CalendarDays,
  grade_settings: SlidersHorizontal,
  school_year: CalendarRange,
  promotion: ArrowUpRight,
  class: AlarmClock,
  scan: ScanLine,
};

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false });

function byDay(items: readonly LogLine[]): { day: string; lines: LogLine[] }[] {
  return items.reduce<{ day: string; lines: LogLine[] }[]>((groups, item) => {
    const last = groups[groups.length - 1];
    return last && last.day === item.day
      ? [...groups.slice(0, -1), { day: last.day, lines: [...last.lines, item] }]
      : [...groups, { day: item.day, lines: [item] }];
  }, []);
}

/** Dòng thời gian nhật ký, nhóm theo ngày (giờ Việt Nam). Mọi chuỗi đi qua React nên được thoát ký tự. */
export function AuditLogList({ items }: { items: readonly LogLine[] }) {
  return (
    <div className="flex flex-col gap-5">
      {byDay(items).map((group) => (
        <section key={group.day} aria-label={dateLabel(group.day)} className="flex flex-col gap-2">
          <h3 className="px-1 font-display text-sm font-semibold text-ink-soft">{dateLabel(group.day)}</h3>
          <ul className="card divide-y divide-border overflow-hidden">
            {group.lines.map((line) => {
              const Icon = ICONS[line.entity] ?? SlidersHorizontal;
              return (
                <li key={`${line.source}-${line.id}`} className="flex min-h-14 items-start gap-3 px-4 py-3">
                  <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-action-tint text-action">
                    <Icon size={16} />
                  </span>
                  <p className="min-w-0 flex-1 break-words text-sm leading-relaxed text-ink">
                    <strong className="font-semibold">{line.actor}</strong> {line.what}
                  </p>
                  <time dateTime={line.at.toISOString()} className="shrink-0 pt-0.5 text-xs tabular-nums text-ink-soft">
                    {TIME.format(line.at)}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
