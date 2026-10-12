import { ChevronLeft, Info } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { nextGradeSettings } from "@/server/services/grade-settings";
import { incomingNotices, INCOMING_DAYS, listPromotions, promotionTargets } from "@/server/services/promotions";
import { schoolYearOverview } from "@/server/services/school-years";
import { applyPromotionAction, createSchoolYearAction, deleteSchoolYearAction, previewPromotionAction, setNextGradeAction, undoPromotionAction } from "./actions";
import { NextGradeForm } from "./NextGradeForm";
import { PromotionHistory } from "./PromotionHistory";
import { PromotionWizard } from "./PromotionWizard";
import { SchoolYearForm } from "./SchoolYearForm";
import { YearList } from "./YearList";

/** Năm học mới + lên lớp (spec §3): chỉ trưởng khối. */
export default async function SchoolYearPage() {
  const user = await requireUser();
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const today = todayInVietnam();
  const [overview, targets, history, next, notices] = await Promise.all([
    schoolYearOverview(db, user, today),
    promotionTargets(db, user),
    listPromotions(db, user),
    nextGradeSettings(db, user),
    incomingNotices(db, user),
  ]);
  if (!overview || !targets || !history || !next || !notices) redirect("/");
  const hasNotices = notices.transfers.length > 0 || notices.links.length > 0;
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/khoi" className="btn btn-ghost btn-sm -ml-2 self-start"><ChevronLeft aria-hidden size={18} /> Khối</Link>
        <h1 className="text-2xl font-semibold">Năm học và lên lớp</h1>
      </div>

      {hasNotices && (
        <aside aria-label="Thay đổi từ khối khác" className="flex gap-3 rounded-card border border-warn-watch/30 bg-warn-watch-tint p-4 text-sm">
          <Info aria-hidden size={20} className="mt-0.5 shrink-0 text-warn-watch" />
          <div className="grid min-w-0 gap-1.5">
            <p className="font-medium">Trong {INCOMING_DAYS} ngày qua, khối khác đã thay đổi liên quan tới khối của bạn:</p>
            <ul className="grid gap-1 text-ink-soft">
              {notices.links.map((l) => <li key={l.id}>{l.text}</li>)}
              {notices.transfers.map((t) => (
                <li key={t.id}>
                  {t.actorName ?? "Một trưởng khối"} ({t.fromGradeName}) chuyển {t.count} em từ {t.fromClassName} vào {t.toClassName}{t.undone ? " (đã hoàn tác)" : ""}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Năm học</h2>
        <YearList years={overview.years} today={today} remove={deleteSchoolYearAction} />
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
