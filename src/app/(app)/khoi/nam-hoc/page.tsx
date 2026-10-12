import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { nextGradeSettings } from "@/server/services/grade-settings";
import { listPromotions, promotionTargets } from "@/server/services/promotions";
import { schoolYearOverview } from "@/server/services/school-years";
import { applyPromotionAction, createSchoolYearAction, previewPromotionAction, setNextGradeAction, undoPromotionAction } from "./actions";
import { NextGradeForm } from "./NextGradeForm";
import { PromotionHistory } from "./PromotionHistory";
import { PromotionWizard } from "./PromotionWizard";
import { SchoolYearForm } from "./SchoolYearForm";

/** Năm học mới + lên lớp (spec §3): chỉ trưởng khối. */
export default async function SchoolYearPage() {
  const user = await requireUser();
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const today = todayInVietnam();
  const [overview, targets, history, next] = await Promise.all([
    schoolYearOverview(db, user, today),
    promotionTargets(db, user),
    listPromotions(db, user),
    nextGradeSettings(db, user),
  ]);
  if (!overview || !targets || !history || !next) redirect("/");
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/khoi" className="btn btn-ghost btn-sm -ml-2 self-start"><ChevronLeft aria-hidden size={18} /> Khối</Link>
        <h1 className="text-2xl font-semibold">Năm học và lên lớp</h1>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Năm học</h2>
        {overview.years.length > 0 && (
          <ul aria-label="Các năm học" className="card divide-y divide-border overflow-hidden">
            {overview.years.map((y) => (
              <li key={y.id} className="px-4 py-3">
                <span className="block font-medium">{y.name}</span>
                {y.terms.map((t) => (
                  <span key={t.id} className="block text-sm tabular-nums text-ink-soft">
                    {t.name}: {shortDate(t.startsOn)} – {shortDate(t.endsOn)}{t.startsOn <= today && today <= t.endsOn ? " · đang học" : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <SchoolYearForm defaults={overview.defaults} action={createSchoolYearAction} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Lên lớp</h2>
        <PromotionWizard options={targets} preview={previewPromotionAction} apply={applyPromotionAction} undo={undoPromotionAction} />
        <NextGradeForm gradeId={next.gradeId} gradeName={next.gradeName} nextGradeId={next.nextGradeId} options={next.options} action={setNextGradeAction} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Các lượt lên lớp gần đây</h2>
        <PromotionHistory items={history} undo={undoPromotionAction} />
      </div>
    </section>
  );
}
