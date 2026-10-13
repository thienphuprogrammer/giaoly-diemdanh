import { db } from "@/db/client";
import { resolveTerm } from "@/db/queries/stats";
import { getCurrentUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { buildStatsWorkbook } from "@/lib/export/excel";
import { exportFilename } from "@/lib/export/filename";
import { massStats } from "@/server/services/mass-stats";
import { classStats } from "@/server/services/stats";
import { guardClass } from "@/server/guard";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: Request, { params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const cls = await guardClass(db, user, classId, "read");
  if (!cls) return new Response("Not found", { status: 404 });
  const term = await resolveTerm(db, new URL(request.url).searchParams.get("termId") ?? undefined, todayInVietnam(), cls.schoolYearId);
  const stats = term ? await classStats(db, user, classId, term.id) : null;
  if (!stats) return new Response("Not found", { status: 404 });
  // Sheet "Đi lễ" riêng (spec §1b); cùng quyền đọc lớp nên luôn có khi `classStats` có.
  const mass = await massStats(db, user, { classId, termId: stats.term.id });
  const buffer = await buildStatsWorkbook({ className: stats.className, termName: stats.term.name, rows: stats.rows, mass: mass ?? undefined });
  const filename = exportFilename(stats.className, stats.term.name);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="diem-danh.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
