import { CalendarRange } from "lucide-react";
import { notFound } from "next/navigation";
import { ReportToolbar } from "@/components/report/ReportToolbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { shortDate } from "@/lib/date-label";
import { DEFAULT_RULES } from "@/lib/attendance/warning";
import { todayInVietnam } from "@/lib/dates";
import { buildReportRows, buildReportTotals, termRangeLabel } from "@/lib/report/term-report";
import { classTermReport } from "@/server/services/term-report";
import { guardClass } from "@/server/guard";

export const metadata = { title: "Báo cáo học kỳ" };

export default async function ClassReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ termId?: string }>;
}) {
  const { classId } = await params;
  const { termId } = await searchParams;
  const user = await requireUser();
  const cls = await guardClass(db, user, classId, "read");
  if (!cls) notFound();
  const today = todayInVietnam();
  const back = `/lop/${classId}/thong-ke${termId ? `?termId=${encodeURIComponent(termId)}` : ""}`;
  const term = await resolveTerm(db, termId, today, cls.schoolYearId);
  if (!term) {
    return <EmptyState icon={CalendarRange} title="Chưa có học kỳ nào">Khi có học kỳ, báo cáo chuyên cần của lớp sẽ in được ở đây.</EmptyState>;
  }
  const report = await classTermReport(db, user, classId, term.id, today);
  if (!report) notFound();
  const rows = buildReportRows(report.rows);
  const totals = buildReportTotals(report.rows);
  return (
    <div className="flex flex-col gap-4">
      <ReportToolbar backHref={back} backLabel="Thống kê" hint="Chọn “Lưu dưới dạng PDF” trong hộp thoại in để lưu file. Khổ giấy A4 dọc." />
      <article className="report-sheet" aria-label={`Báo cáo ${report.className} ${report.term.name}`}>
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink-soft">Điểm danh Giáo lý</p>
          <h1 className="text-xl font-semibold">Báo cáo chuyên cần · {report.className}</h1>
          <dl className="report-meta">
            <div><dt className="inline text-ink-soft">Khối: </dt><dd className="inline">{report.gradeName || "—"}</dd></div>
            <div><dt className="inline text-ink-soft">Học kỳ: </dt><dd className="inline">{report.term.name} ({termRangeLabel(report.term.startsOn, report.term.endsOn)})</dd></div>
            <div><dt className="inline text-ink-soft">Ngày lập: </dt><dd className="inline">{shortDate(today)}</dd></div>
            <div><dt className="inline text-ink-soft">Người lập: </dt><dd className="inline">{user.name}</dd></div>
            <div><dt className="inline text-ink-soft">Tuần đi lễ đã ghi: </dt><dd className="inline tabular-nums">{report.massWeeks}</dd></div>
          </dl>
        </header>
        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong p-4 text-ink-soft">Lớp chưa có thiếu nhi nào trong học kỳ này.</p>
        ) : (
          <div className="report-scroll">
            <table className="report-table">
              <caption className="sr-only">Chuyên cần từng em, {report.className}, {report.term.name}</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">STT</th>
                  <th scope="col">Tên thánh</th>
                  <th scope="col">Họ tên</th>
                  <th scope="col" className="num">Có mặt</th>
                  <th scope="col" className="num">Muộn</th>
                  <th scope="col" className="num">Vắng có phép</th>
                  <th scope="col" className="num">Vắng không phép</th>
                  <th scope="col" className="num">% chuyên cần</th>
                  <th scope="col" className="num">Đi lễ (đi/đã ghi)</th>
                  <th scope="col">Cảnh báo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.studentId}>
                    <td className="num">{r.stt}</td>
                    <td>{r.saintName}</td>
                    <td>{r.fullName}</td>
                    <td className="num">{r.present}</td>
                    <td className="num">{r.late}</td>
                    <td className="num">{r.excused}</td>
                    <td className="num">{r.unexcused}</td>
                    <td className="num">{r.percent}</td>
                    <td className="num">{r.mass}</td>
                    <td>{r.warning}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Tổng cộng ({totals.students} em)</td>
                  <td className="num">{totals.present}</td>
                  <td className="num">{totals.late}</td>
                  <td className="num">{totals.excused}</td>
                  <td className="num">{totals.unexcused}</td>
                  <td className="num">{totals.percent}</td>
                  <td className="num">{totals.mass}</td>
                  <td>{totals.warnings} em cảnh báo</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-soft">
          % chuyên cần = (có mặt + đi muộn) / số buổi đã ghi. Cảnh báo khi vắng không phép từ {DEFAULT_RULES.unexcusedThreshold} buổi hoặc vắng lễ từ {report.massThreshold} tuần trong học kỳ.
          {" "}Em ghi “(đã lên lớp khác)” hoặc “(đã nghỉ)” không còn học ở lớp này nhưng vẫn có số liệu trong học kỳ.
        </p>
      </article>
    </div>
  );
}
