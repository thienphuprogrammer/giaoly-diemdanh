import { CalendarRange, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getSystemAdminOverview } from "@/server/services/system-admin";
import { AccountsPanel } from "./AccountsPanel";
import { ClassesPanel } from "./ClassesPanel";
import { GradesPanel } from "./GradesPanel";

export const metadata = { title: "Quản trị | Điểm danh Giáo lý" };

const SECTIONS = [
  { id: "accounts", label: "Tài khoản" },
  { id: "grades", label: "Khối" },
  { id: "classes", label: "Lớp" },
] as const;

export default async function SystemAdminPage({ searchParams }: {
  searchParams: Promise<{ section?: string; schoolYearId?: string; gradeId?: string; q?: string }>;
}) {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  const params = await searchParams;
  const section = SECTIONS.some((item) => item.id === params.section) ? params.section! : "accounts";
  const result = await getSystemAdminOverview(db, user, { schoolYearId: params.schoolYearId, gradeId: params.gradeId || undefined, query: params.q });
  if (!result.ok) return <Notice tone="error" role="alert">{result.error}</Notice>;
  const overview = result.data;
  const sectionHref = (id: string) => {
    const query = new URLSearchParams({ section: id });
    if (overview.selectedSchoolYearId) query.set("schoolYearId", overview.selectedSchoolYearId);
    if (params.gradeId) query.set("gradeId", params.gradeId);
    if (params.q) query.set("q", params.q);
    return `/quan-tri?${query.toString()}`;
  };

  return (
    <div className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck aria-hidden size={24} className="text-action" />Quản trị hệ thống</h1><p className="mt-1 text-ink-soft">Tài khoản, khối và lớp của tất cả năm học.</p></div>
        <Link href="/quan-tri/nam-hoc" className="btn btn-secondary"><CalendarRange aria-hidden size={18} />Quản lý năm học</Link>
      </header>
      <dl aria-label="Tổng quan quản trị" className="grid grid-cols-2 divide-border overflow-hidden rounded-card border border-border bg-surface sm:grid-cols-4 sm:divide-x">
        <Metric label="Tài khoản đang hoạt động" value={overview.counts.activeAccounts} />
        <Metric label="Khối" value={overview.counts.grades} />
        <Metric label="Lớp trong năm" value={overview.counts.classes} />
        <Metric label="Thiếu nhi trong năm" value={overview.counts.students} />
      </dl>
      <nav aria-label="Mục quản trị" className="flex gap-1 border-b border-border">
        {SECTIONS.map((item) => <Link key={item.id} href={sectionHref(item.id)} aria-current={section === item.id ? "page" : undefined} className={`inline-flex min-h-12 flex-1 items-center justify-center border-b-2 px-3 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${section === item.id ? "border-action text-action" : "border-transparent text-ink-soft hover:border-border-strong hover:text-ink"}`}>{item.label}</Link>)}
      </nav>
      <form action="/quan-tri" method="get" className="card grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-end">
        <input type="hidden" name="section" value={section} />
        <Field label="Năm học"><select name="schoolYearId" defaultValue={overview.selectedSchoolYearId ?? ""} className="input" disabled={overview.schoolYears.length === 0}>{overview.schoolYears.length === 0 && <option value="">Chưa có năm học</option>}{overview.schoolYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></Field>
        <Field label="Khối"><select name="gradeId" defaultValue={params.gradeId ?? ""} className="input"><option value="">Tất cả khối</option>{overview.grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.name}</option>)}</select></Field>
        <Field label="Tìm kiếm"><input name="q" type="search" defaultValue={params.q ?? ""} maxLength={120} placeholder={section === "accounts" ? "Tên hoặc email" : section === "classes" ? "Tên lớp" : "Tên khối"} className="input" /></Field>
        <button className="btn btn-secondary">Lọc danh sách</button>
      </form>
      {section === "accounts" ? <AccountsPanel overview={overview} actorId={user.id} /> : section === "grades" ? <GradesPanel overview={overview} query={params.q} gradeId={params.gradeId} /> : <ClassesPanel overview={overview} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="px-4 py-3"><dt className="text-sm text-ink-soft">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>;
}
