import { History } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditLogList } from "@/components/audit/AuditLogList";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { LOG_GROUPS, groupFromSlug, logHref } from "@/lib/audit/groups";
import { listAuditLog } from "@/server/services/audit-log";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ tu?: string | string[]; den?: string | string[]; loai?: string | string[]; sau?: string | string[] }>;
}) {
  const { classId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const [tu, den, sau] = [first(sp.tu), first(sp.den), first(sp.sau)];
  const group = groupFromSlug(first(sp.loai));
  const page = await listAuditLog(db, user, { classId, from: tu, to: den, group, cursor: sau });
  if (!page) notFound();
  const filtered = Boolean(tu || den || group !== "all");
  const keep = { from: tu, to: den, group };
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Nhật ký thay đổi</h2>
        <p className="text-sm text-ink-soft">Ai đã sửa gì, lúc nào. Nhật ký được giữ 12 tháng.</p>
      </div>
      <nav aria-label="Lọc theo loại" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6">
        {LOG_GROUPS.map((g) => {
          const active = g.group === group;
          return (
            <Link key={g.group} prefetch={false} href={logHref(classId, { from: tu, to: den, group: g.group })} aria-current={active ? "page" : undefined}
              className={`btn btn-sm shrink-0 ${active ? "btn-primary" : "btn-secondary"}`}>
              {g.label}
            </Link>
          );
        })}
      </nav>
      {/* GET thuần (không cần JS): bộ lọc nằm trên URL nên chia sẻ/tải lại được. */}
      <form method="get" className="card grid grid-cols-2 items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
        {group !== "all" && <input type="hidden" name="loai" value={LOG_GROUPS.find((g) => g.group === group)?.slug} />}
        <Field label="Từ ngày"><input type="date" name="tu" defaultValue={tu ?? ""} className="input" /></Field>
        <Field label="Đến ngày"><input type="date" name="den" defaultValue={den ?? ""} className="input" /></Field>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <button type="submit" className="btn btn-primary btn-lg flex-1">Lọc</button>
          {filtered && <Link prefetch={false} href={logHref(classId)} className="btn btn-secondary btn-lg">Xoá lọc</Link>}
        </div>
      </form>
      {page.items.length === 0 ? (
        <EmptyState icon={History} title={sau ? "Hết nhật ký" : "Chưa có dòng nhật ký nào"}
          action={sau ? <Link prefetch={false} href={logHref(classId, keep)} className="btn btn-secondary btn-lg">Về đầu danh sách</Link> : undefined}>
          {sau ? "Không còn dòng nào cũ hơn." : filtered ? "Không có thay đổi nào khớp bộ lọc này." : "Khi có người điểm danh hay sửa thông tin, các thay đổi sẽ hiện ở đây."}
        </EmptyState>
      ) : (
        <>
          <AuditLogList items={page.items} />
          <div className="flex flex-col gap-2">
            {page.nextCursor && (
              <Link prefetch={false} href={logHref(classId, { ...keep, cursor: page.nextCursor })} className="btn btn-secondary btn-lg w-full">
                Xem thêm
              </Link>
            )}
            {sau && <Link prefetch={false} href={logHref(classId, keep)} className="btn btn-ghost btn-lg w-full">Về đầu danh sách</Link>}
          </div>
        </>
      )}
    </section>
  );
}
