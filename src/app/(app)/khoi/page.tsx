import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { listClassesForUser } from "@/db/queries/classes";
import { classCatechists, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { assignAction, createCatechistAction, createClassAction, unassignAction } from "./actions";
import { SimpleForm } from "@/components/forms/SimpleForm";

export default async function GradePage() {
  const user = await requireUser();
  if (!user.isGradeHead || !user.gradeId) redirect("/");
  const [classList, catechists, links] = await Promise.all([
    listClassesForUser(db, user),
    db.select().from(users).where(eq(users.gradeId, user.gradeId)),
    db.select().from(classCatechists),
  ]);
  const classOptions = classList.map((c) => ({ value: c.id, label: c.name }));
  // Trưởng khối cũng nằm trong danh sách để tự gán mình vào lớp khi cần ghi điểm danh thay GLV.
  const glvOptions = catechists.map((u) => ({ value: u.id, label: u.name }));
  const namesOf = (classId: string) =>
    links.filter((l) => l.classId === classId).map((l) => catechists.find((u) => u.id === l.userId)?.name).filter(Boolean).join(", ");
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Khối</h1>
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
