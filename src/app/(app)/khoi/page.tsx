import { eq, inArray } from "drizzle-orm";
import { CalendarRange, KeyRound, Link2, Plus, Unlink, UserPlus, UsersRound } from "lucide-react";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { classCatechists, users } from "@/db/schema";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { gradeOverview } from "@/server/services/stats";
import { assignAction, createCatechistAction, createClassAction, resetPasswordAction, unassignAction } from "./actions";
import { SimpleForm } from "@/components/forms/SimpleForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { WarningPill } from "@/components/ui/Pill";

export default async function GradePage() {
  const user = await requireUser();
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const classList = await listClassesForUser(db, user);
  const classIds = classList.map((c) => c.id);
  const term = await resolveTerm(db, undefined, todayInVietnam());
  const [catechists, links, overview] = await Promise.all([
    db.select({ id: users.id, name: users.name, isGradeHead: users.isGradeHead }).from(users).where(eq(users.gradeId, user.gradeId)),
    classIds.length === 0 ? Promise.resolve([]) : db.select().from(classCatechists).where(inArray(classCatechists.classId, classIds)),
    term ? gradeOverview(db, user, term.id) : Promise.resolve([]),
  ]);
  const classOptions = classList.map((c) => ({ value: c.id, label: c.name }));
  // Trưởng khối cũng nằm trong danh sách để tự gán mình vào lớp khi cần ghi điểm danh thay GLV.
  const glvOptions = catechists.map((u) => ({ value: u.id, label: u.name }));
  const resetOptions = catechists.filter((u) => !u.isGradeHead).map((u) => ({ value: u.id, label: u.name }));
  const namesOf = (classId: string) =>
    links.filter((l) => l.classId === classId).map((l) => catechists.find((u) => u.id === l.userId)?.name).filter(Boolean).join(", ");
  return (
    <section className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Khối</h1>
      {!term ? (
        <EmptyState icon={CalendarRange} title="Chưa có học kỳ nào">Khi có học kỳ, tỉ lệ có mặt của từng lớp sẽ hiện ở đây.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Tổng quan {term.name}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {overview?.map((r) => {
              const pct = r.presentRate === null ? null : Math.round(r.presentRate * 100);
              return (
                <li key={r.classId} className="card flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block break-words font-display text-lg font-semibold">{r.className}</span>
                      <span className="text-sm tabular-nums text-ink-soft">{r.studentCount} em · {r.sessions} buổi</span>
                    </span>
                    {r.warningCount > 0 && <WarningPill level="warning">{r.warningCount} cảnh báo</WarningPill>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0">
                      <span className="block font-display text-2xl font-semibold leading-none tabular-nums">{pct === null ? "—" : `${pct}%`}</span>
                      <span className="text-xs text-ink-soft">có mặt</span>
                    </span>
                    <span aria-hidden className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <span className="block h-full origin-left rounded-full bg-st-present" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Lớp và giáo lý viên</h2>
        <ul className="card divide-y divide-border overflow-hidden">
          {classList.map((c) => (
            <li key={c.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
              <UsersRound aria-hidden size={20} className="shrink-0 text-ink-muted" />
              <span className="min-w-0">
                <span className="block font-medium">{c.name}</span>
                <span className="block text-sm text-ink-soft"><span className="tabular-nums">{c.studentCount}</span> em · GLV: {namesOf(c.id) || <span className="text-warn-watch">chưa gán</span>}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold">Quản lý</h2>
          <p className="mt-0.5 text-sm text-ink-soft">Tạo lớp, tài khoản và phân công giáo lý viên trong khối.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SimpleForm title="Tạo lớp" icon={<Plus aria-hidden size={20} />} action={createClassAction} fields={[{ name: "name", label: "Tên lớp" }]} />
          <SimpleForm title="Tạo tài khoản GLV" icon={<UserPlus aria-hidden size={20} />} action={createCatechistAction}
            fields={[{ name: "name", label: "Họ tên" }, { name: "email", label: "Email", type: "email" }, { name: "password", label: "Mật khẩu (≥ 10 ký tự)", type: "password" }]} />
          <SimpleForm title="Gán GLV vào lớp" icon={<Link2 aria-hidden size={20} />} action={assignAction}
            fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
          <SimpleForm title="Gỡ GLV khỏi lớp" icon={<Unlink aria-hidden size={20} />} action={unassignAction}
            fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
        </div>
      </div>
      {resetOptions.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-warn-alert">Thao tác nhạy cảm</h2>
          <SimpleForm title="Đặt lại mật khẩu" tone="sensitive" icon={<KeyRound aria-hidden size={20} />}
            description="Mật khẩu cũ của giáo lý viên sẽ không dùng được nữa. Báo mật khẩu mới cho họ trực tiếp."
            action={resetPasswordAction}
            fields={[
              { name: "userId", label: "Giáo lý viên", options: resetOptions },
              { name: "password", label: "Mật khẩu mới (10–72 ký tự)", type: "password", autoComplete: "new-password", minLength: 10, maxLength: 72 },
            ]} />
        </div>
      )}
    </section>
  );
}
