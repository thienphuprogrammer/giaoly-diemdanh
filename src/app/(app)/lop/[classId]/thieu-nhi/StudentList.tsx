"use client";

import { Search, UsersRound, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { useFilteredListFocus } from "@/components/ui/useFilteredListFocus";
import { filterRoster } from "@/lib/attendance/roster-search";
import { StudentRow, type RosterStudent } from "./StudentRow";

type StudentStatus = "all" | "active" | "hidden" | "former";

export function StudentList({ classId, students, canWrite }: {
  classId: string;
  students: (RosterStudent & { former: boolean })[];
  canWrite: boolean;
}) {
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StudentStatus>("all");
  const selected = students.filter((student) => status === "all"
    || (status === "former" ? student.former : !student.former && student.active === (status === "active")));
  const visible = query.trim() ? filterRoster(selected, query, selected.length) : selected;
  const hasFilter = query.length > 0 || status !== "all";
  const onListFocus = useFilteredListFocus(visible, searchId);

  function clearFilters() {
    setQuery("");
    setStatus("all");
    searchInput.current?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] lg:max-w-3xl">
        <Field label="Tìm thiếu nhi" hint="Nhập họ tên hoặc tên thánh, có dấu hoặc không dấu.">
          <span className="relative block min-w-0">
            <Search aria-hidden size={20} className="pointer-events-none absolute top-3.5 left-3 text-ink-muted" />
            <input id={searchId} ref={searchInput} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              className="input pl-10" placeholder="Ví dụ: Nguyễn An, Maria" aria-describedby="roster-result-count" />
          </span>
        </Field>
        <Field label="Trạng thái">
          <select value={status} onChange={(event) => setStatus(event.target.value as StudentStatus)} className="input">
            <option value="all">Tất cả</option>
            <option value="active">Đang học</option>
            <option value="hidden">Đã ẩn</option>
            <option value="former">Đã chuyển lớp</option>
          </select>
        </Field>
      </div>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p id="roster-result-count" role="status" className="text-sm text-ink-soft">
          Hiển thị <span className="font-medium tabular-nums text-ink">{visible.length}</span> / <span className="tabular-nums">{students.length}</span> em
        </p>
        {hasFilter && (
          <button type="button" onClick={clearFilters} className="btn btn-secondary">
            <X aria-hidden size={18} /> Xóa bộ lọc
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <EmptyState icon={UsersRound} title="Không tìm thấy thiếu nhi phù hợp">
          Thử tên khác hoặc xóa bộ lọc để xem lại cả lớp.
        </EmptyState>
      ) : (
        <div className="card overflow-hidden">
          <div aria-hidden className={`hidden gap-3 border-b border-border bg-surface-muted px-4 py-2.5 text-xs font-semibold text-ink-soft lg:grid ${canWrite ? "lg:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem]" : "lg:grid-cols-[minmax(0,1fr)_7rem_9rem]"}`}>
            <span>Thiếu nhi / tên thánh</span>
            <span>Ngày sinh</span>
            <span>SĐT phụ huynh</span>
            {canWrite && <span className="text-right">Thao tác</span>}
          </div>
          <ul onFocusCapture={onListFocus} className="divide-y divide-border">
            {visible.map((student) => (
              <StudentRow key={student.id} classId={classId} canWrite={canWrite && !student.former} student={student} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
