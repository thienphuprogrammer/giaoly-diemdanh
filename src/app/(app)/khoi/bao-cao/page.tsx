import { CalendarRange, Download } from "lucide-react";
import { notFound } from "next/navigation";
import { TermTabs } from "@/components/nav/TermTabs";
import { ReportToolbar } from "@/components/report/ReportToolbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { db } from "@/db/client";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { termById } from "@/db/queries/stats";
import { SchoolYearFilter } from "@/components/nav/SchoolYearFilter";
import { listSchoolYearsForUser, resolveSchoolYearForUser } from "@/server/services/school-years";
import { requireUser } from "@/lib/auth/dal";
import { shortDate } from "@/lib/date-label";
import { todayInVietnam } from "@/lib/dates";
import { formatPercent, termRangeLabel } from "@/lib/report/term-report";
import { gradeReport } from "@/server/services/term-report";

export const metadata = { title: "Báo cáo khối" };

export default async function GradeReportPage({ searchParams }: { searchParams: Promise<{ termId?: string; schoolYearId?: string; gradeId?: string }> }) {
  const { termId, schoolYearId, gradeId: requestedGradeId } = await searchParams;
  const user = await requireUser();
  const gradeId = user.isAdmin ? requestedGradeId : user.isGradeHead ? user.gradeId : null;
  if (!gradeId) notFound();
  const today = todayInVietnam();
  const explicitTerm = termId ? await termById(db, termId) : null;
  const year = await resolveSchoolYearForUser(db, user, schoolYearId ?? explicitTerm?.schoolYearId, today);
  const years = await listSchoolYearsForUser(db, user);
  const term = year ? await resolveTerm(db, termId, today, year.id) : null;
  if (!term) {
    return <EmptyState icon={CalendarRange} title="Chưa có học kỳ nào">Khi có học kỳ, báo cáo tổng hợp của khối sẽ in được ở đây.</EmptyState>;
  }
  const [report, terms] = await Promise.all([gradeReport(db, user, term.id, today, gradeId), listTerms(db, term.schoolYearId)]);
  if (!report) notFound();
  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar backHref={user.isAdmin ? `/quan-tri?section=grades&schoolYearId=${term.schoolYearId}` : `/khoi?schoolYearId=${term.schoolYearId}`} backLabel={user.isAdmin ? "Quản trị" : "Khối"} hint="Chọn “Lưu dưới dạng PDF” trong hộp thoại in để lưu file. Khổ giấy A4 dọc." />
      <div className="print:hidden"><SchoolYearFilter years={years} selectedSchoolYearId={term.schoolYearId} action="/khoi/bao-cao" preserveFields={user.isAdmin ? { gradeId } : {}} /></div>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <TermTabs terms={terms} currentId={term.id} preserveParams={{ schoolYearId: term.schoolYearId, ...(user.isAdmin ? { gradeId } : {}) }} />
        <a href={`/khoi/bao-cao/export?termId=${term.id}${user.isAdmin ? `&gradeId=${gradeId}` : ""}`} className="btn btn-secondary">
          <Download aria-hidden size={20} />Xuất Excel
        </a>
      </div>
      <article className="report-sheet" aria-label={`Báo cáo ${report.gradeName} ${report.term.name}`}>
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink-soft">Điểm danh Giáo lý</p>
          <h1 className="text-xl font-semibold">Báo cáo tổng hợp · {report.gradeName}</h1>
          <dl className="report-meta">
            <div><dt className="inline text-ink-soft">Học kỳ: </dt><dd className="inline">{report.term.name} ({termRangeLabel(report.term.startsOn, report.term.endsOn)})</dd></div>
            <div><dt className="inline text-ink-soft">Ngày lập: </dt><dd className="inline">{shortDate(today)}</dd></div>
            <div><dt className="inline text-ink-soft">Người lập: </dt><dd className="inline">{user.name}</dd></div>
          </dl>
        </header>
        {report.classes.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong p-4 text-ink-soft">Khối chưa có lớp nào.</p>
        ) : (
          <div className="report-scroll">
            <table className="report-table">
              <caption className="sr-only">Tổng hợp từng lớp của {report.gradeName}, {report.term.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Lớp</th>
                  <th scope="col" className="num">Sĩ số</th>
                  <th scope="col" className="num">Buổi học đã tổ chức</th>
                  <th scope="col" className="num">% có mặt</th>
                  <th scope="col" className="num">Em cảnh báo vắng KP</th>
                  <th scope="col" className="num">Em cảnh báo vắng lễ</th>
                  <th scope="col" className="num">Tuần lễ đã ghi</th>
                </tr>
              </thead>
              <tbody>
                {report.classes.map((c) => (
                  <tr key={c.classId}>
                    <td>{c.className}</td>
                    <td className="num">{c.studentCount}</td>
                    <td className="num">{c.sessions}</td>
                    <td className="num">{formatPercent(c.presentRate)}</td>
                    <td className="num">{c.unexcusedWarnings}</td>
                    <td className="num">{c.massWarnings}</td>
                    <td className="num">{c.massWeeks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <section aria-labelledby="grade-warned" className="flex flex-col gap-2">
          <h2 id="grade-warned" className="text-base font-semibold">Em đang cảnh báo (đang học ở lớp) ({report.warnings.length})</h2>
          {report.warnings.length === 0 ? (
            <p className="text-sm text-ink-soft">Không có em nào chạm ngưỡng cảnh báo trong học kỳ này.</p>
          ) : (
            <div className="report-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col" className="num">STT</th>
                    <th scope="col">Họ tên</th>
                    <th scope="col">Lớp</th>
                    <th scope="col">Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.warnings.map((w, i) => (
                    <tr key={w.studentId}>
                      <td className="num">{i + 1}</td>
                      <td>{w.fullName}</td>
                      <td>{w.className}</td>
                      <td>{[w.unexcused !== null ? `Vắng KP ${w.unexcused} buổi` : "", w.missedMass !== null ? `Vắng lễ ${w.missedMass} tuần` : ""].filter(Boolean).join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <p className="text-xs text-ink-soft">Sĩ số, % có mặt và số em cảnh báo theo lớp tính mọi em có trong học kỳ (kể cả em đã lên lớp khác hoặc đã nghỉ); danh sách bên dưới chỉ gồm em đang học ở lớp. % có mặt = (có mặt + đi muộn) / số lượt đã ghi. Buổi đi lễ tính riêng, không lẫn vào buổi học.</p>
      </article>
    </div>
  );
}
