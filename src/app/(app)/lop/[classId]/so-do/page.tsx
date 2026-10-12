import { LayoutGrid, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { db } from "@/db/client";
import { getPlan, listPlans } from "@/db/queries/seating";
import { listStudents } from "@/db/queries/students";
import { visibleAssignments } from "@/lib/seating/assignments";
import { requireUser } from "@/lib/auth/dal";
import { classPermissions } from "@/server/guard";
import { createPlanAction } from "./actions";
import { ApplyTemplate } from "./ApplyTemplate";
import { NewPlanForm } from "./NewPlanForm";
import { PlanActions } from "./PlanActions";
import { SeatEditor } from "./SeatEditor";

export default async function SeatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ plan?: string; v?: string }>;
}) {
  const { classId } = await params;
  const { plan: planParam, v: version } = await searchParams;
  const user = await requireUser();
  const perms = await classPermissions(db, user, classId);
  if (!perms.canRead) notFound();

  const plans = await listPlans(db, classId);
  const selected = plans.find((p) => p.id === planParam) ?? plans.find((p) => p.isActive) ?? plans[0];
  const data = selected ? await getPlan(db, selected.id) : null;
  const students = (await listStudents(db, classId)).map((s) => ({ id: s.id, fullName: s.fullName }));

  const activeIds = new Set(students.map((s) => s.id));

  return (
    <section className="flex flex-col gap-6">
      {plans.length > 0 && (
        <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Các sơ đồ">
          {plans.map((p) => {
            const current = p.id === selected?.id;
            return (
              <Link key={p.id} href={`?plan=${p.id}`} aria-current={current ? "page" : undefined}
                className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 font-display text-sm font-medium transition-colors ${current ? "border-action bg-action text-on-action" : "border-border-strong bg-surface text-ink hover:bg-surface-muted"}`}>
                {p.isActive && <Star aria-hidden size={16} />}
                {p.name}
                {p.isActive && <span className="sr-only"> (đang dùng)</span>}
              </Link>
            );
          })}
        </nav>
      )}
      {data && selected && (
        <>
          <SeatEditor key={`${selected.id}:${version ?? ""}`} classId={classId} planId={selected.id} initialLayout={data.plan.layout}
            initialAssignments={visibleAssignments(data.assignments, activeIds)} students={students} canWrite={perms.canWrite} />
          {perms.canWrite && data.assignments.length === 0 && (
            <ApplyTemplate classId={classId} planId={selected.id} studentCount={students.length} />
          )}
          {perms.canWrite && !selected.isActive && <PlanActions classId={classId} planId={selected.id} />}
        </>
      )}
      {!data && (
        <EmptyState icon={LayoutGrid} title="Lớp chưa có sơ đồ">
          {perms.canWrite ? "Đặt tên cho sơ đồ đầu tiên ở bên dưới và chọn một mẫu bố cục." : "Giáo lý viên phụ trách lớp sẽ tạo sơ đồ chỗ ngồi."}
        </EmptyState>
      )}
      {perms.canWrite && <NewPlanForm action={createPlanAction.bind(null, classId)} studentCount={students.length} />}
    </section>
  );
}
