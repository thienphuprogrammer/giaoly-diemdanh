import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import type { SystemAdminOverview } from "@/server/services/system-admin";
import { AdminForm } from "./AdminForm";

export function GradesPanel({ overview, query = "", gradeId }: { overview: SystemAdminOverview; query?: string; gradeId?: string }) {
  const { grades } = overview;
  const needle = query.trim().toLocaleLowerCase("vi");
  const shownGrades = grades.filter((grade) => (!gradeId || grade.id === gradeId) && (!needle || grade.name.toLocaleLowerCase("vi").includes(needle)));
  return (
    <section aria-labelledby="admin-grades" className="grid min-w-0 gap-4">
      <div><h2 id="admin-grades" className="text-xl font-semibold">Tất cả khối</h2><p className="mt-1 text-sm text-ink-soft">Khối dùng chung qua các năm học. Mỗi lớp trong khối thuộc một năm học riêng.</p></div>
      <details className="card group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold hover:bg-surface-muted">Tạo khối mới<ChevronRight aria-hidden size={18} className="transition-transform group-open:rotate-90" /></summary>
        <div className="border-t border-border p-4"><AdminForm intent="create-grade" submitLabel="Tạo khối"><div className="grid gap-3 sm:grid-cols-2"><Field label="Tên khối"><input name="name" required maxLength={60} className="input" /></Field><ThresholdField /></div></AdminForm></div>
      </details>
      {shownGrades.length === 0 ? <p className="card p-4 text-ink-soft">{grades.length === 0 ? "Chưa có khối nào. Tạo khối trước khi tạo lớp và phân công khối trưởng." : "Không có khối phù hợp với bộ lọc."}</p> : <ul aria-label="Danh sách khối" className="grid gap-3">
        {shownGrades.map((grade) => <li key={grade.id} className="card overflow-hidden">
          <details className="group">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"><span className="min-w-0"><span className="block break-words font-semibold">{grade.name}</span><span className="mt-1 block text-sm text-ink-soft">{grade.classCount} lớp · {grade.accountCount} tài khoản</span></span><ChevronRight aria-hidden size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-90" /></summary>
            <div className="grid gap-5 border-t border-border p-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <AdminForm intent="update-grade" submitLabel="Lưu khối"><input type="hidden" name="gradeId" value={grade.id} /><Field label="Tên khối"><input name="name" defaultValue={grade.name} required maxLength={60} className="input" /></Field><ThresholdField value={grade.massThreshold} /><Field label="Khối tiếp theo khi lên lớp"><select name="nextGradeId" defaultValue={grade.nextGradeId ?? ""} className="input"><option value="">Chưa đặt khối tiếp theo</option>{grades.filter((other) => other.id !== grade.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}</select></Field></AdminForm>
              <div className="grid content-start gap-3"><Link href={`/khoi/bao-cao?gradeId=${grade.id}${overview.selectedSchoolYearId ? `&schoolYearId=${overview.selectedSchoolYearId}` : ""}`} className="btn btn-secondary" prefetch={false}>Báo cáo khối theo năm</Link><h3 className="font-semibold">Xoá khối tạo nhầm</h3><p className="text-sm text-ink-soft">Chỉ xoá được khối chưa có lớp, tài khoản hoặc liên kết lên lớp.</p><AdminForm intent="delete-grade" submitLabel="Xoá khối" sensitive disabled={grade.classCount > 0 || grade.accountCount > 0} confirmation={`Xoá khối ${grade.name}? Thao tác này chỉ được phép khi khối chưa được sử dụng.`}><input type="hidden" name="gradeId" value={grade.id} /></AdminForm></div>
            </div>
          </details>
        </li>)}
      </ul>}
    </section>
  );
}

function ThresholdField({ value = 3 }: { value?: number }) {
  return <Field label="Ngưỡng cảnh báo vắng lễ (tuần)"><input name="massThreshold" type="number" min={1} max={52} defaultValue={value} required className="input" /></Field>;
}
