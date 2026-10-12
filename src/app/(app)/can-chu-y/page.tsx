import { Church, CircleCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, WarningPill } from "@/components/ui/Pill";
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { DEFAULT_RULES } from "@/lib/attendance/warning";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { massAttentionList } from "@/server/services/mass-stats";
import { attentionList } from "@/server/services/stats";
import { AttentionGroups, type AttentionEntry } from "./AttentionGroups";

export default async function AttentionPage() {
  const user = await requireUser();
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const [items, massItems] = term
    ? await Promise.all([attentionList(db, user, term.id), massAttentionList(db, user, term.id)])
    : [[], []];
  const classEntries: AttentionEntry[] = items.map((i) => ({
    ...i,
    badge: (
      <WarningPill level={i.level === "warning" ? "warning" : "watch"}>
        {i.level === "warning" ? `Cảnh báo · ${i.unexcused} buổi` : "Vắng 1 buổi"}
      </WarningPill>
    ),
  }));
  // Cảnh báo đi lễ tính riêng (spec §1b): nhãn "Đi lễ" có biểu tượng + chữ, không chỉ màu; một em có thể ở cả hai nhóm.
  const massEntries: AttentionEntry[] = massItems.map((i) => ({
    ...i,
    badge: <Pill tone="alert" icon={Church}>Đi lễ · vắng lễ {i.missed} tuần</Pill>,
  }));
  const both = classEntries.length > 0 && massEntries.length > 0;
  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cần chú ý</h1>
        <p className="mt-1 text-ink-soft">
          {term?.name ?? "Chưa có học kỳ"} · vắng không phép từ {DEFAULT_RULES.unexcusedThreshold} buổi là cảnh báo; vắng lễ tính riêng theo ngưỡng của khối.
        </p>
      </div>
      {classEntries.length === 0 && massEntries.length === 0 && (
        <EmptyState icon={CircleCheck} title="Chưa em nào cần chú ý">
          Khi một em vắng không phép, tên em sẽ hiện ở đây để bạn kịp hỏi thăm gia đình.
        </EmptyState>
      )}
      {classEntries.length > 0 && (
        <section aria-labelledby="attention-class" className="flex flex-col gap-3">
          <h2 id="attention-class" className={both ? "text-xl font-semibold" : "sr-only"}>Vắng buổi học</h2>
          <AttentionGroups entries={classEntries} />
        </section>
      )}
      {massEntries.length > 0 && (
        <section aria-labelledby="attention-mass" className="flex flex-col gap-3">
          <div>
            <h2 id="attention-mass" className="flex items-center gap-2 text-xl font-semibold">
              <Church aria-hidden size={20} className="text-ink-muted" />Đi lễ
            </h2>
            <p className="mt-0.5 text-sm text-ink-soft">Các em vắng lễ từ ngưỡng của khối trong học kỳ (chỉ tính tuần lớp đã ghi đi lễ).</p>
          </div>
          <AttentionGroups entries={massEntries} />
        </section>
      )}
    </section>
  );
}
