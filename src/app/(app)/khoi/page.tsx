import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { classCatechists, users } from "@/db/schema";
import { resolveTerm } from "@/db/queries/stats";
import { requireUser } from "@/lib/auth/dal";
import { todayInVietnam } from "@/lib/dates";
import { gradeOverview } from "@/server/services/stats";
import { assignAction, createCatechistAction, createClassAction, unassignAction } from "./actions";
import { SimpleForm } from "@/components/forms/SimpleForm";

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
  const namesOf = (classId: string) =>
    links.filter((l) => l.classId === classId).map((l) => catechists.find((u) => u.id === l.userId)?.name).filter(Boolean).join(", ");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Khối</h1>
      <div className="rounded-2xl border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Tổng quan {term?.name}</h2>
        <ul className="divide-y divide-line">
          {overview?.map((r) => (
            <li key={r.classId} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.className}</span>
                <span className="text-sm text-ink-soft">{r.studentCount} em · {r.sessions} buổi</span>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block">{r.presentRate === null ? "—" : `${Math.round(r.presentRate * 100)}% có mặt`}</span>
                {r.warningCount > 0 && <span className="font-semibold text-warn-alert">{r.warningCount} cảnh báo</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex flex-col gap-2">
        {classList.map((c) => (
          <li key={c.id} className="rounded-2xl border border-line bg-card p-4">
            <span className="font-semibold">{c.name}</span>
            <span className="block text-sm text-ink-soft">{c.studentCount} em · GLV: {namesOf(c.id) || "chưa gán"}</span>
          </li>
        ))}
      </ul>
      <SimpleForm title="Tạo lớp" action={createClassAction} fields={[{ name: "name", label: "Tên lớp" }]} />
      <SimpleForm title="Tạo tài khoản GLV" action={createCatechistAction}
        fields={[{ name: "name", label: "Họ tên" }, { name: "email", label: "Email", type: "email" }, { name: "password", label: "Mật khẩu (≥ 10 ký tự)", type: "password" }]} />
      <SimpleForm title="Gán GLV vào lớp" action={assignAction}
        fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
      <SimpleForm title="Gỡ GLV khỏi lớp" action={unassignAction}
        fields={[{ name: "classId", label: "Lớp", options: classOptions }, { name: "userId", label: "Giáo lý viên", options: glvOptions }]} />
    </section>
  );
}
