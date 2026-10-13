import { ChevronRight, UsersRound } from "lucide-react";
import Link from "next/link";
import { Field } from "@/components/ui/Field";
import type { SystemAdminOverview } from "@/server/services/system-admin";
import { AdminForm } from "./AdminForm";

export function ClassesPanel({ overview }: { overview: SystemAdminOverview }) {
  const { accountChoices, grades, schoolYears, classes, selectedSchoolYearId } = overview;
  const selectedYear = schoolYears.find((year) => year.id === selectedSchoolYearId);
  return (
    <section aria-labelledby="admin-classes" className="grid min-w-0 gap-4">
      <div><h2 id="admin-classes" className="text-xl font-semibold">Lớp {selectedYear ? `năm học ${selectedYear.name}` : "theo năm học"}</h2><p className="mt-1 text-sm text-ink-soft">Tạo lớp mới cho từng năm, phân công giáo lý viên và mở danh sách thiếu nhi. Lịch sử năm trước được giữ lại.</p></div>
      <details className="card group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold hover:bg-surface-muted">Tạo lớp mới<ChevronRight aria-hidden size={18} className="transition-transform group-open:rotate-90" /></summary>
        <div className="border-t border-border p-4">
          {schoolYears.length === 0 || grades.length === 0 ? <p className="text-sm text-ink-soft">Tạo năm học và khối trước khi thêm lớp.</p> : <AdminForm intent="create-class" submitLabel="Tạo lớp"><div className="grid gap-3 md:grid-cols-3"><Field label="Tên lớp"><input name="name" required maxLength={60} className="input" /></Field><Field label="Khối"><select name="gradeId" required defaultValue="" className="input"><option value="">Chọn khối</option>{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></Field><Field label="Năm học"><select name="schoolYearId" required defaultValue={selectedSchoolYearId ?? ""} className="input"><option value="">Chọn năm học</option>{schoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></Field></div></AdminForm>}
        </div>
      </details>
      {classes.length === 0 ? <p className="card p-4 text-ink-soft">Không có lớp phù hợp với năm học và bộ lọc đang chọn.</p> : <ul aria-label="Danh sách lớp quản trị" className="grid gap-3">
        {classes.map((cls) => {
          const available = accountChoices.filter((account) => account.isActive && !cls.catechists.some((assigned) => assigned.id === account.id));
          return <li key={cls.id} className="card min-w-0 overflow-hidden">
            <details className="group">
              <summary className="flex min-h-20 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted"><span className="min-w-0"><span className="block break-words font-semibold">{cls.name}</span><span className="mt-1 block text-sm text-ink-soft">{cls.gradeName} · {cls.schoolYearName}</span><span className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-soft"><UsersRound aria-hidden size={15} />{cls.studentCount} thiếu nhi · {cls.catechists.length} giáo lý viên</span></span><ChevronRight aria-hidden size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-90" /></summary>
              <div className="grid gap-5 border-t border-border p-4 xl:grid-cols-2">
                <div className="grid content-start gap-5">
                  <Link href={`/lop/${cls.id}`} className="btn btn-secondary justify-self-start">Mở lớp và danh sách thiếu nhi</Link>
                  <AdminForm intent="update-class" submitLabel="Lưu thông tin lớp"><input type="hidden" name="classId" value={cls.id} /><Field label="Tên lớp"><input name="name" defaultValue={cls.name} required maxLength={60} className="input" /></Field><Field label="Khối"><select name="gradeId" defaultValue={cls.gradeId} required className="input">{grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></Field><p className="text-sm text-ink-soft">Năm học: {cls.schoolYearName}. Tạo lớp riêng khi bắt đầu năm mới.</p></AdminForm>
                  <div className="grid gap-3"><p className="text-sm text-ink-soft">Chỉ xoá lớp chưa có thiếu nhi, điểm danh hoặc phân công.</p><AdminForm intent="delete-class" submitLabel="Xoá lớp" sensitive disabled={cls.studentCount > 0 || cls.catechists.length > 0} confirmation={`Xoá lớp ${cls.name} của năm học ${cls.schoolYearName}? Lớp đang có dữ liệu sẽ không thể xoá.`}><input type="hidden" name="classId" value={cls.id} /></AdminForm></div>
                </div>
                <div className="grid content-start gap-4">
                  <h3 className="font-semibold">Giáo lý viên phụ trách</h3>
                  {cls.catechists.length === 0 ? <p className="text-sm text-ink-soft">Chưa phân công giáo lý viên.</p> : <ul className="grid gap-3">
                    {cls.catechists.map((account) => <li key={account.id} className="grid gap-2 rounded-control border border-border p-3"><div><p className="break-words font-medium">{account.name}</p><p className="break-all text-sm text-ink-soft">{account.email}</p></div><AdminForm intent="unassign-account" submitLabel="Gỡ khỏi lớp" sensitive confirmation={`Gỡ ${account.name} khỏi ${cls.name} (${cls.schoolYearName})? Quyền phụ trách lớp này sẽ được thu hồi; lịch sử điểm danh vẫn giữ nguyên.`}><input type="hidden" name="classId" value={cls.id} /><input type="hidden" name="userId" value={account.id} /></AdminForm></li>)}
                  </ul>}
                  {available.length > 0 && <AdminForm intent="assign-account" submitLabel="Phân công vào lớp"><input type="hidden" name="classId" value={cls.id} /><Field label="Giáo lý viên hoặc khối trưởng"><select name="userId" required defaultValue="" className="input"><option value="">Chọn tài khoản</option>{available.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}{account.role === "head" ? " · Khối trưởng" : account.role === "admin" ? " · Quản trị viên" : ""}</option>)}</select></Field></AdminForm>}
                </div>
              </div>
            </details>
          </li>;
        })}
      </ul>}
    </section>
  );
}
