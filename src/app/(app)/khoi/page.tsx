import { eq, inArray } from "drizzle-orm";
import { ArrowUpRight, CalendarRange, ChevronRight, FileText, KeyRound, Link2, Plus, Unlink, UserPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { SchoolYearFilter } from "@/components/nav/SchoolYearFilter";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { classCatechists, users } from "@/db/schema";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { getGradeSettings } from "@/server/services/grade-settings";
import { gradeOverview } from "@/server/services/stats";
import { listSchoolYearsForUser, resolveSchoolYearForUser, schoolYearOverview } from "@/server/services/school-years";
import { assignAction, createCatechistAction, createClassAction, resetPasswordAction, setMassThresholdAction, unassignAction } from "./actions";
import { MassThresholdForm } from "./MassThresholdForm";
import { SimpleForm } from "@/components/forms/SimpleForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { WarningPill } from "@/components/ui/Pill";

export default async function GradePage({ searchParams }: { searchParams: Promise<{ schoolYearId?: string }> }) {
  const { schoolYearId } = await searchParams;
  const user = await requireUser();
  if (user.isAdmin) redirect("/quan-tri");
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const today = todayInVietnam();
  const [years, schoolYear, allYears] = await Promise.all([
    listSchoolYearsForUser(db, user),
    resolveSchoolYearForUser(db, user, schoolYearId, today),
    schoolYearOverview(db, user, today),
  ]);
  const classList = schoolYear ? await listClassesForUser(db, user, schoolYear.id) : [];
  const classIds = classList.map((c) => c.id);
  const term = schoolYear ? await resolveTerm(db, undefined, today, schoolYear.id) : null;
  const [catechists, links, overview, settings] = await Promise.all([
    db.select({ id: users.id, name: users.name, isGradeHead: users.isGradeHead }).from(users).where(eq(users.gradeId, user.gradeId)),
    classIds.length === 0 ? Promise.resolve([]) : db.select().from(classCatechists).where(inArray(classCatechists.classId, classIds)),
    term ? gradeOverview(db, user, term.id) : Promise.resolve([]),
    getGradeSettings(db, user),
  ]);
  const classOptions = classList.map((c) => ({ value: c.id, label: c.name }));
  const yearOptions = [
    { value: "", label: "Chọn năm học" },
    ...(allYears?.years ?? []).map((y) => ({ value: y.id, label: y.name })),
  ];
  // Trưởng khối cũng nằm trong danh sách để tự gán mình vào lớp khi cần ghi điểm danh thay GLV.
  const glvOptions = catechists.map((u) => ({ value: u.id, label: u.name }));
  const resetOptions = catechists.filter((u) => !u.isGradeHead).map((u) => ({ value: u.id, label: u.name }));
  const namesOf = (classId: string) =>
    links.filter((l) => l.classId === classId).map((l) => catechists.find((u) => u.id === l.userId)?.name).filter(Boolean).join(", ");
  return (
    <section className="flex min-w-0 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Khối</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {schoolYear && <>{schoolYear.name} · </>}<span className="tabular-nums">{classList.length}</span> lớp · <span className="tabular-nums">{catechists.length}</span> giáo lý viên
        </p>
      </div>
      <SchoolYearFilter years={years} selectedSchoolYearId={schoolYear?.id ?? null} action="/khoi" />
      {!term ? (
        <EmptyState icon={CalendarRange} title="Chưa có học kỳ nào">Khi có học kỳ, tỉ lệ có mặt của từng lớp sẽ hiện ở đây.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Tổng quan {term.name}</h2>
          <div className="card overflow-hidden">
            <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_5rem_5rem_8rem_6rem] items-center gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold text-ink-soft lg:grid">
              <span>Lớp</span><span className="text-right">Thiếu nhi</span><span className="text-right">Số buổi</span><span className="text-right">Tỉ lệ có mặt</span><span className="text-right">Cảnh báo</span>
            </div>
            <ul className="divide-y divide-border">
              {overview?.map((r) => {
                const pct = r.presentRate === null ? null : Math.round(r.presentRate * 100);
                return (
                  <li key={r.classId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_5rem_5rem_8rem_6rem] lg:py-3">
                    <span className="col-start-1 row-start-1 min-w-0 break-words font-semibold lg:font-medium">{r.className}</span>
                    <span className="col-start-1 row-start-2 flex flex-wrap items-center gap-2 text-sm tabular-nums text-ink-soft lg:contents">
                      <span className="lg:col-start-2 lg:row-start-1 lg:text-right"><span className="lg:text-ink">{r.studentCount}</span><span className="lg:sr-only"> em</span></span>
                      <span aria-hidden className="lg:hidden">·</span>
                      <span className="lg:col-start-3 lg:row-start-1 lg:text-right"><span className="lg:text-ink">{r.sessions}</span><span className="lg:sr-only"> buổi</span></span>
                    </span>
                    <span className="col-start-2 row-start-2 text-right text-sm tabular-nums lg:col-start-4 lg:row-start-1">
                      <span className="font-semibold">{pct === null ? "—" : `${pct}%`}</span>
                      <span className="ml-1 text-xs text-ink-soft lg:sr-only">có mặt</span>
                    </span>
                    <span className="col-start-2 row-start-1 flex justify-end text-sm tabular-nums lg:col-start-5">
                      {r.warningCount > 0 ? <WarningPill level="warning">{r.warningCount}<span className="lg:sr-only"> cảnh báo</span></WarningPill> : <span className="hidden text-ink-soft lg:inline">0<span className="sr-only"> cảnh báo</span></span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Lớp và giáo lý viên</h2>
        {classList.length === 0 ? (
          <EmptyState icon={UsersRound} title="Khối chưa có lớp">Mở “Tạo lớp và tài khoản” bên dưới để thêm lớp đầu tiên.</EmptyState>
        ) : (
          <div className="card overflow-hidden">
            <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_6rem_1rem] gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold text-ink-soft lg:grid">
              <span>Lớp</span><span>Giáo lý viên phụ trách</span><span className="text-right">Thiếu nhi</span><span />
            </div>
            <ul className="divide-y divide-border">
              {classList.map((c) => (
                <li key={c.id} className="min-w-0">
                  <Link href={`/lop/${c.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-muted lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_6rem_1rem]">
                    <span className="col-start-1 row-start-1 break-words font-medium">{c.name}</span>
                    <span className="col-start-1 row-start-2 break-words text-sm text-ink-soft lg:col-start-2 lg:row-start-1"><span className="lg:sr-only">GLV: </span>{namesOf(c.id) || <span className="text-warn-watch">chưa gán</span>}</span>
                    <span className="col-start-2 row-start-1 text-right text-sm tabular-nums text-ink-soft lg:col-start-3"><span className="lg:text-ink">{c.studentCount}</span><span className="lg:sr-only"> em</span></span>
                    <ChevronRight aria-hidden size={18} className="col-start-2 row-start-2 justify-self-end text-ink-muted lg:col-start-4 lg:row-start-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">Quản lý</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Mở nhóm thao tác cần dùng để tạo lớp, tài khoản hoặc phân công giáo lý viên.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/khoi/nam-hoc" className="card flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted">
            <ArrowUpRight aria-hidden size={20} className="shrink-0 text-action" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Năm học mới và lên lớp</span>
              <span className="block text-sm text-ink-soft">Tạo năm học, chuyển em sang lớp mới (hoàn tác được trong 24 giờ)</span>
            </span>
            <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted" />
          </Link>
          <Link href={term ? `/khoi/bao-cao?termId=${term.id}` : "/khoi/bao-cao"} prefetch={false} className="card flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-muted">
            <FileText aria-hidden size={20} className="shrink-0 text-action" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Báo cáo học kỳ của khối</span>
              <span className="block text-sm text-ink-soft">Tổng hợp từng lớp, danh sách em cảnh báo; in A4 hoặc xuất Excel</span>
            </span>
            <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted" />
          </Link>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ManagementGroup title="Phân công giáo lý viên" description="Gán hoặc gỡ giáo lý viên khỏi lớp.">
            <SimpleForm title="Gán GLV vào lớp" icon={<Link2 aria-hidden size={20} />} action={assignAction}
              fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
            <SimpleForm title="Gỡ GLV khỏi lớp" icon={<Unlink aria-hidden size={20} />} action={unassignAction}
              fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
          </ManagementGroup>
          <ManagementGroup title="Tạo lớp và tài khoản" description="Thêm lớp mới hoặc tài khoản cho giáo lý viên.">
            <SimpleForm title="Tạo lớp" icon={<Plus aria-hidden size={20} />} action={createClassAction}
              description="Mỗi lớp thuộc một năm học. Tạo năm học trước khi thêm lớp của năm mới."
              fields={[{ name: "schoolYearId", label: "Năm học", options: yearOptions }, { name: "name", label: "Tên lớp" }]} />
            <SimpleForm title="Tạo tài khoản GLV" icon={<UserPlus aria-hidden size={20} />} action={createCatechistAction}
              fields={[{ name: "name", label: "Họ tên" }, { name: "email", label: "Email", type: "email" }, { name: "password", label: "Mật khẩu (≥ 10 ký tự)", type: "password" }]} />
          </ManagementGroup>
        </div>
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        {settings && <MassThresholdForm gradeId={settings.gradeId} threshold={settings.massThreshold} action={setMassThresholdAction} />}
        {resetOptions.length > 0 && (
          <ManagementGroup title="Thao tác nhạy cảm" description="Đặt lại mật khẩu cho giáo lý viên." sensitive>
            <SimpleForm title="Đặt lại mật khẩu" tone="sensitive" icon={<KeyRound aria-hidden size={20} />}
              description="Mật khẩu cũ của giáo lý viên sẽ không dùng được nữa. Báo mật khẩu mới cho họ trực tiếp."
              action={resetPasswordAction}
              fields={[
                { name: "userId", label: "Giáo lý viên", options: resetOptions },
                { name: "password", label: "Mật khẩu mới (10–72 ký tự)", type: "password", autoComplete: "new-password", minLength: 10, maxLength: 72 },
              ]} />
          </ManagementGroup>
        )}
      </div>
    </section>
  );
}

function ManagementGroup({ title, description, sensitive = false, children }: {
  title: string;
  description: string;
  sensitive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={`card group min-w-0 ${sensitive ? "border-warn-alert/40" : ""}`}>
      <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-3 hover:bg-surface-muted">
        <span className="min-w-0">
          <span className={`block font-display font-semibold ${sensitive ? "text-warn-alert" : "text-ink"}`}>{title}</span>
          <span className="mt-0.5 block text-sm text-ink-soft">{description}</span>
        </span>
        <ChevronRight aria-hidden size={20} className="shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {children}
      </div>
    </details>
  );
}
