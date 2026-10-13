import { CalendarRange } from "lucide-react";

/** Server-rendered filter: the selected year stays in the URL and works without JavaScript. */
export function SchoolYearFilter({ years, selectedSchoolYearId, action = "", preserveFields = {} }: {
  years: { id: string; name: string }[];
  selectedSchoolYearId: string | null;
  action?: string;
  preserveFields?: Record<string, string>;
}) {
  return (
    <form method="get" action={action} className="flex min-w-0 flex-wrap items-end gap-3">
      {Object.entries(preserveFields).filter(([name]) => name !== "schoolYearId").map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
        <span className="label inline-flex items-center gap-1.5"><CalendarRange aria-hidden size={16} />Năm học</span>
        <select key={selectedSchoolYearId} name="schoolYearId" defaultValue={selectedSchoolYearId ?? ""}
          required disabled={years.length === 0} className="input">
          {years.length === 0 && <option value="">Chưa có năm học</option>}
          {years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
        </select>
      </label>
      <button type="submit" disabled={years.length === 0} className="btn btn-secondary">Xem năm học</button>
    </form>
  );
}
