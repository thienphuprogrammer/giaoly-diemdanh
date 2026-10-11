"use client";
import { useRouter } from "next/navigation";

export function OpenDate({ classId, today }: { classId: string; today: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      Điểm danh bù ngày
      <input type="date" max={today} onChange={(e) => e.target.value && router.push(`/lop/${classId}/diem-danh/${e.target.value}`)}
        className="h-11 rounded-lg border border-line bg-card px-3" />
    </label>
  );
}
