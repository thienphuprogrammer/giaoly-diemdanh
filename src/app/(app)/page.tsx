import { ArrowRight, CalendarDays, ChartColumn, Check, Church, CircleCheck, ClipboardCheck, Clock, GraduationCap, QrCode, ShieldCheck, TriangleAlert, UsersRound } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, ReadOnlyPill } from "@/components/ui/Pill";
import { SchoolYearFilter } from "@/components/nav/SchoolYearFilter";
import { requireUser } from "@/lib/auth/dal";
import { dateLabel, shortDate } from "@/lib/date-label";
import { evaluateWarningFromCount } from "@/lib/attendance/warning";
import { db } from "@/db/client";
import { homeOverview } from "@/server/services/home";

export const metadata = { title: "Trang chủ | Điểm danh Giáo lý" };

type HomeClass = Awaited<ReturnType<typeof homeOverview>>["classes"][number];

export default async function HomePage({ searchParams }: { searchParams: Promise<{ schoolYearId?: string }> }) {
  const user = await requireUser();
  const { schoolYearId } = await searchParams;
  const overview = await homeOverview(db, user, undefined, schoolYearId);
  const { today, classes, attention, summary, activeTerm, term, schoolYear, years } = overview;
  const canManage = user.isAdmin || (user.isGradeHead && !!user.gradeId);
  const managementHref = user.isAdmin ? "/quan-tri" : "/khoi";
  const classesHref = schoolYear ? `/lop?schoolYearId=${schoolYear.id}` : "/lop";
  const attentionHref = term ? `/can-chu-y?termId=${term.id}` : "/can-chu-y";
  const completed = classes.filter((c) => c.session && !c.session.cancelled && c.studentCount > 0 && c.session.marked === c.studentCount).length;
  const recentAttention = attention.slice(0, 5);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Trang chủ</h1>
          <p className="mt-1 text-ink-soft">Xin chào, {user.name}.</p>
        </div>
        <p className="flex items-center gap-2 text-sm font-medium text-ink-soft">
          <CalendarDays aria-hidden size={18} />{dateLabel(today)}
        </p>
      </header>

      <SchoolYearFilter years={years} selectedSchoolYearId={schoolYear?.id ?? null} action="/" />

      <dl aria-label="Tổng quan" className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-card border border-border bg-surface">
        <SummaryNumber label="Lớp" count={summary.classes} />
        <SummaryNumber label="Thiếu nhi" count={summary.students} />
        <SummaryNumber label="Cần chú ý" count={summary.attention} alert={summary.attention > 0} />
      </dl>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="home-today" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="home-today" className="text-lg font-semibold">{activeTerm ? "Buổi học hôm nay" : "Lớp trong năm học đang xem"}</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {!activeTerm ? "Mở lớp để xem danh sách và điểm danh của năm học này." : completed > 0 ? `${completed} lớp đã ghi đủ điểm danh.` : "Mở lớp để điểm danh hoặc xem tiến độ đã ghi."}
              </p>
            </div>
            <Link href={classesHref} className="btn btn-ghost btn-sm -mr-2">Xem tất cả lớp<ArrowRight aria-hidden size={16} /></Link>
          </div>
          {classes.length === 0 ? (
            <EmptyState icon={GraduationCap} title={user.isAdmin ? "Năm học chưa có lớp" : "Bạn chưa có lớp trong năm học này"}>
              {canManage ? "Tạo lớp theo năm học và phân công giáo lý viên để bắt đầu." : "Chọn năm học khác hoặc nhờ trưởng khối gán lớp cho bạn."}
              {canManage && <Link href={managementHref} className="btn btn-primary mt-3">{user.isAdmin ? "Quản lý toàn hệ thống" : "Quản lý khối"}</Link>}
            </EmptyState>
          ) : (
            <ul aria-label="Các lớp hôm nay" className="card divide-y divide-border overflow-hidden">
              {classes.map((c) => (
                <TodayClass key={c.id} cls={c} today={today} hasActiveTerm={!!activeTerm} />
              ))}
            </ul>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby="home-tools" className="card overflow-hidden">
            <h2 id="home-tools" className="border-b border-border bg-surface-muted px-4 py-3 text-base font-semibold">Truy cập nhanh</h2>
            <div className="divide-y divide-border">
              <QuickLink href={classesHref} label="Danh sách lớp" description="Thiếu nhi, sơ đồ và các buổi học" icon={UsersRound} />
              <QuickLink href={attentionHref} label="Theo dõi các em" description="Vắng học và vắng lễ cần hỏi thăm" icon={TriangleAlert} />
              {canManage && <QuickLink href={managementHref} label={user.isAdmin ? "Quản trị hệ thống" : "Quản lý khối"} description={user.isAdmin ? "Tài khoản, tất cả khối, lớp và năm học" : "Phân công và tổng quan từng lớp"} icon={user.isAdmin ? ShieldCheck : GraduationCap} />}
            </div>
          </section>

          <section aria-labelledby="home-term" className="card overflow-hidden">
            <h2 id="home-term" className="border-b border-border bg-surface-muted px-4 py-3 text-base font-semibold">Học kỳ</h2>
            <div className="flex flex-col gap-2 p-4">
              {schoolYear && <p className="text-sm text-ink-soft">Năm học {schoolYear.name}</p>}
              {term ? (
                <>
                  <p className="font-medium">{term.name}</p>
                  <p className="text-sm tabular-nums text-ink-soft">{shortDate(term.startsOn)} – {shortDate(term.endsOn)}</p>
                  {!activeTerm && <p className="text-sm text-ink-soft">Chưa có học kỳ cho ngày hôm nay. Các cảnh báo bên dưới thuộc học kỳ đang xem.</p>}
                </>
              ) : <p className="text-sm text-ink-soft">Chưa có học kỳ. Cần tạo học kỳ trước khi mở buổi điểm danh.</p>}
              {canManage && <Link href={user.isAdmin ? "/quan-tri/nam-hoc" : "/khoi/nam-hoc"} className="btn btn-secondary btn-sm mt-1">{user.isAdmin ? "Quản lý năm học" : "Năm học và lên lớp"}</Link>}
            </div>
          </section>
        </div>
      </div>

      <section aria-labelledby="home-attention" className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="home-attention" className="text-lg font-semibold">Cần chú ý</h2>
            <p className="mt-1 text-sm text-ink-soft">{term ? `Các em cần hỏi thăm trong ${term.name}.` : "Cảnh báo sẽ hiện khi có dữ liệu điểm danh."}</p>
          </div>
          {attention.length > 0 && <Link href={attentionHref} className="btn btn-ghost btn-sm -mr-2">Xem tất cả<ArrowRight aria-hidden size={16} /></Link>}
        </div>
        {recentAttention.length === 0 ? (
          <div className="card flex items-start gap-3 p-4">
            <CircleCheck aria-hidden size={20} className="mt-0.5 shrink-0 text-st-present" />
            <div><p className="font-medium">Chưa có em cần chú ý</p><p className="mt-1 text-sm text-ink-soft">Khi có em vắng học hoặc vắng lễ cần theo dõi, thông tin sẽ xuất hiện ở đây.</p></div>
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {recentAttention.map((item) => (
              <li key={item.studentId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/lop/${item.classId}/thieu-nhi/${item.studentId}`} className="inline-flex min-h-11 items-center break-words font-medium text-action hover:underline">{item.fullName}</Link>
                  <p className="text-sm text-ink-soft">{item.className}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.classAbsences !== null && <Pill tone={evaluateWarningFromCount(item.classAbsences).level === "warning" ? "alert" : "watch"} icon={TriangleAlert}>Vắng học {item.classAbsences} buổi</Pill>}
                  {item.massMissed !== null && <Pill tone="alert" icon={Church}>Vắng lễ {item.massMissed} tuần</Pill>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryNumber({ label, count, alert = false }: { label: string; count: number; alert?: boolean }) {
  return (
    <div className="px-3 py-4 sm:px-5">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? "text-warn-watch" : "text-ink"}`}>{count}</dd>
    </div>
  );
}

function TodayClass({ cls, today, hasActiveTerm }: { cls: HomeClass; today: string; hasActiveTerm: boolean }) {
  const { session, studentCount } = cls;
  const marked = session?.marked ?? 0;
  const complete = !!session && !session.cancelled && studentCount > 0 && marked === studentCount;
  const base = `/lop/${cls.id}`;
  const nameId = `home-class-${cls.id}`;
  const board = `${base}/diem-danh/${today}`;
  const canOpenToday = hasActiveTerm || !!session;
  const label = !cls.canWrite ? "Xem buổi hôm nay" : complete ? "Xem điểm danh" : marked > 0 ? "Tiếp tục điểm danh" : "Điểm danh hôm nay";
  return (
    <li className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link id={nameId} href={base} className="inline-flex min-h-11 items-center break-words text-base font-semibold hover:text-action hover:underline">{cls.name}</Link>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1.5"><UsersRound aria-hidden size={15} />{studentCount} em</span>
            <span className="inline-flex items-center gap-1.5"><Clock aria-hidden size={15} />{cls.scheduleLabel ?? "Chưa đặt lịch học"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!cls.canWrite && <ReadOnlyPill />}
          {session?.cancelled ? <Pill>Nghỉ lễ</Pill> : complete ? <Pill tone="action" icon={Check}>Đã ghi đủ</Pill> : <Pill>{studentCount === 0 ? "Chưa có thiếu nhi" : session ? `${marked}/${studentCount} đã điểm danh` : "Chưa mở buổi"}</Pill>}
        </div>
      </div>
      {!!session && !session.cancelled && studentCount > 0 && (
        <div role="progressbar" aria-label={`Tiến độ ${cls.name}`} aria-valuemin={0} aria-valuemax={studentCount} aria-valuenow={marked} className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full origin-left bg-action" style={{ transform: `scaleX(${marked / studentCount})` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {studentCount === 0 && cls.canWrite ? (
          <Link href={`${base}/thieu-nhi`} aria-describedby={nameId} className="btn btn-primary btn-sm">Thêm thiếu nhi</Link>
        ) : !canOpenToday ? (
          <Link href={base} aria-describedby={nameId} className="btn btn-secondary btn-sm">Mở lớp</Link>
        ) : (
          <>
            <Link prefetch={false} href={board} aria-describedby={nameId} className={`btn btn-sm ${cls.canWrite && !session?.cancelled && !complete ? "btn-primary" : "btn-secondary"}`}>
              <ClipboardCheck aria-hidden size={17} />{session?.cancelled ? "Xem buổi nghỉ lễ" : label}
            </Link>
            {cls.canWrite && !session?.cancelled && studentCount > 0 && <Link prefetch={false} href={`${board}/quet`} aria-describedby={nameId} className="btn btn-secondary btn-sm"><QrCode aria-hidden size={17} />Quét QR</Link>}
          </>
        )}
        {!cls.canWrite && <Link href={`${base}/thong-ke`} aria-describedby={nameId} className="btn btn-secondary btn-sm"><ChartColumn aria-hidden size={17} />Thống kê</Link>}
      </div>
    </li>
  );
}

function QuickLink({ href, label, description, icon: Icon }: { href: string; label: string; description: string; icon: typeof UsersRound }) {
  return (
    <Link href={href} className="flex min-h-20 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted">
      <Icon aria-hidden size={20} className="shrink-0 text-ink-soft" />
      <div className="min-w-0 flex-1"><p className="font-medium">{label}</p><p className="mt-1 text-sm text-ink-soft">{description}</p></div>
      <ArrowRight aria-hidden size={16} className="shrink-0 text-ink-muted" />
    </Link>
  );
}
