import { Check, TriangleAlert } from "lucide-react";
import { Pill } from "@/components/ui/Pill";
import { buildTemplateLayout, capacityStatus, templateCapacity, type SeatingTemplate } from "@/lib/seating/templates";
import { TemplateThumb } from "./TemplateThumb";

type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "className">;

const CARD = "card flex min-h-11 w-full flex-col gap-2 p-3 text-left transition-colors hover:bg-surface-muted disabled:opacity-50";

/** Thẻ mẫu: hình thu nhỏ, tên, mô tả, số chỗ và huy hiệu so với sĩ số thật của lớp. Là một nút bấm. */
export function TemplateCard({ template, studentCount, ...button }: { template: SeatingTemplate; studentCount: number } & ButtonProps) {
  let n = 0;
  const layout = buildTemplateLayout(template.id, () => `t${++n}`) ?? []; // id tất định: dùng được ở cả server lẫn client
  const capacity = templateCapacity(template);
  const status = capacityStatus(capacity, studentCount);
  return (
    <button type="button" {...button} className={CARD}>
      <span className="flex h-24 items-center justify-center rounded-control border border-border bg-surface-muted p-1">
        <TemplateThumb layout={layout} className="h-full w-full" />
      </span>
      <span className="font-display text-base font-semibold text-ink">{template.name}</span>
      <span className="text-sm text-ink-soft">{template.description}</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
        <span className="font-display font-semibold tabular-nums text-ink">{capacity} chỗ</span>
        <span aria-hidden>·</span>
        <span>{template.classSize}</span>
      </span>
      {studentCount > 0 && (
        <Pill tone={status.fits ? "action" : "alert"} icon={status.fits ? Check : TriangleAlert} className="self-start">
          {status.badge}
        </Pill>
      )}
    </button>
  );
}

/** Thẻ "Sơ đồ trống": bố cục mặc định, tự thêm bớt trong trình chỉnh. */
export function BlankCard(button: ButtonProps) {
  return (
    <button type="button" {...button} className={CARD}>
      <span className="font-display text-base font-semibold text-ink">Sơ đồ trống</span>
      <span className="text-sm text-ink-soft">Bắt đầu từ 3 hàng mặc định, tự thêm bớt hàng và băng ghế.</span>
    </button>
  );
}
