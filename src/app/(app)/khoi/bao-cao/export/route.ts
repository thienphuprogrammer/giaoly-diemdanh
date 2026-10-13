import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { getCurrentUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { buildGradeWorkbook } from "@/lib/export/grade-excel";
import { exportFilename } from "@/lib/export/filename";
import { gradeReport } from "@/server/services/term-report";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Xuất Excel tổng hợp khối: chỉ trưởng khối của khối đó; GLV thường và người ngoài nhận 404 (chưa đăng nhập: 401). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const today = todayInVietnam();
  const query = new URL(request.url).searchParams;
  const term = await resolveTerm(db, query.get("termId") ?? undefined, today, query.get("schoolYearId") ?? undefined);
  const report = term ? await gradeReport(db, user, term.id, today, query.get("gradeId") ?? undefined) : null;
  if (!report) return new Response("Not found", { status: 404 });
  const buffer = await buildGradeWorkbook(report);
  const filename = exportFilename(report.gradeName, report.term.name, "tong-hop-khoi");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="tong-hop-khoi.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
