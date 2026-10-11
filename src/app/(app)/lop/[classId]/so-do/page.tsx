import Link from "next/link";
import { notFound } from "next/navigation";
import { SimpleForm } from "@/components/forms/SimpleForm";
import { db } from "@/db/client";
import { getPlan, listPlans } from "@/db/queries/seating";
import { listStudents } from "@/db/queries/students";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { activatePlanAction, createPlanAction, deletePlanAction } from "./actions";
import { SeatEditor } from "./SeatEditor";

export default async function SeatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ plan?: string }>;
}) {
  const { classId } = await params;
  const { plan: planParam } = await searchParams;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();

  const plans = await listPlans(db, classId);
  const selected = plans.find((p) => p.id === planParam) ?? plans.find((p) => p.isActive) ?? plans[0];
  const data = selected ? await getPlan(db, selected.id) : null;
  const students = (await listStudents(db, classId)).map((s) => ({ id: s.id, fullName: s.fullName }));

  return (
    <section className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-2" aria-label="Các sơ đồ">
        {plans.map((p) => (
          <Link key={p.id} href={`?plan=${p.id}`}
            className={`flex h-11 items-center rounded-full border px-4 text-sm ${p.id === selected?.id ? "border-brand bg-brand text-white" : "border-line bg-card"}`}>
            {p.name}{p.isActive ? " ★" : ""}
          </Link>
        ))}
      </nav>
      {data && selected && (
        <>
          <SeatEditor key={selected.id} classId={classId} planId={selected.id} initialLayout={data.plan.layout}
            initialAssignments={data.assignments} students={students} canWrite={perms.canWrite} />
          {perms.canWrite && (
            <div className="flex gap-2">
              {!selected.isActive && (
                <form action={async () => { "use server"; await activatePlanAction(classId, selected.id); }}>
                  <button className="h-11 rounded-lg border border-line bg-card px-4 text-sm">Dùng sơ đồ này</button>
                </form>
              )}
              {!selected.isActive && (
                <form action={async () => { "use server"; await deletePlanAction(classId, selected.id); }}>
                  <button className="h-11 rounded-lg border border-line bg-card px-4 text-sm text-warn-alert">Xóa sơ đồ</button>
                </form>
              )}
            </div>
          )}
        </>
      )}
      {!data && <p className="text-ink-soft">Lớp chưa có sơ đồ{perms.canWrite ? ". Hãy tạo sơ đồ đầu tiên." : "."}</p>}
      {perms.canWrite && (
        <SimpleForm title="Tạo sơ đồ mới" action={createPlanAction.bind(null, classId)} fields={[{ name: "name", label: "Tên sơ đồ" }]} />
      )}
    </section>
  );
}
