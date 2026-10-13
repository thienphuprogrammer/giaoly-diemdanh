import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { schoolYearOverview } from "@/server/services/school-years";
import { promotionTargets, listPromotions } from "@/server/services/promotions";
import { SchoolYearForm } from "../../khoi/nam-hoc/SchoolYearForm";
import { YearList } from "../../khoi/nam-hoc/YearList";
import { createAdminSchoolYearAction, deleteAdminSchoolYearAction, previewAdminPromotionAction, applyAdminPromotionAction, undoAdminPromotionAction } from "../actions";
import { PromotionWizard } from "../../khoi/nam-hoc/PromotionWizard";
import { PromotionHistory } from "../../khoi/nam-hoc/PromotionHistory";
import { AdminForm } from "../AdminForm";
import { Field } from "@/components/ui/Field";

export const metadata = { title: "Năm học | Quản trị" };

export default async function AdminSchoolYearsPage() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  const today = todayInVietnam();
  const [overview, targets, history] = await Promise.all([schoolYearOverview(db, user, today), promotionTargets(db, user), listPromotions(db, user)]);
  if (!overview || !targets || !history) redirect("/");
  return (
    <section className="grid gap-6">
      <header><Link href="/quan-tri" className="btn btn-ghost btn-sm -ml-2"><ChevronLeft aria-hidden size={18} />Quản trị</Link><h1 className="mt-2 text-2xl font-semibold">Quản lý năm học</h1><p className="mt-1 text-ink-soft">Mỗi năm học có lớp và học kỳ riêng. Bạn có thể dùng lại tên lớp ở năm mới; dữ liệu điểm danh năm trước vẫn giữ nguyên.</p></header>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="grid gap-3"><h2 className="text-xl font-semibold">Các năm học</h2>{overview.years.length === 0 ? <p className="card p-4 text-ink-soft">Chưa có năm học. Tạo năm học đầu tiên để thêm lớp.</p> : <YearList years={overview.years} today={today} remove={deleteAdminSchoolYearAction} />}<Link href="/quan-tri?section=classes" className="btn btn-secondary justify-self-start">Tạo và phân công lớp theo năm</Link></div>
        <SchoolYearForm defaults={overview.defaults} action={createAdminSchoolYearAction} />
      </div>
      {overview.years.length > 0 && <details className="card group"><summary className="flex min-h-14 cursor-pointer items-center px-4 py-3 font-semibold">Đổi tên năm học</summary><div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">{overview.years.map((year) => <AdminForm key={year.id} intent="rename-school-year" submitLabel="Lưu tên năm học"><input type="hidden" name="schoolYearId" value={year.id} /><Field label={`Tên năm học ${year.name}`}><input name="name" defaultValue={year.name} required maxLength={40} className="input" /></Field></AdminForm>)}</div></details>}
      <section aria-labelledby="admin-rollover" className="grid gap-3"><h2 id="admin-rollover" className="text-xl font-semibold">Chuyển thiếu nhi sang lớp hoặc năm học mới</h2><p className="text-sm text-ink-soft">Tạo lớp của năm mới trước, rồi chọn lớp nguồn và lớp đích. Hồ sơ, mã QR và điểm danh cũ được giữ nguyên.</p><PromotionWizard canManageAll options={targets} preview={previewAdminPromotionAction} apply={applyAdminPromotionAction} undo={undoAdminPromotionAction} /></section>
      <section aria-labelledby="admin-rollover-history" className="grid gap-3"><h2 id="admin-rollover-history" className="text-xl font-semibold">Các lượt chuyển lớp gần đây</h2><PromotionHistory items={history} undo={undoAdminPromotionAction} /></section>
    </section>
  );
}
