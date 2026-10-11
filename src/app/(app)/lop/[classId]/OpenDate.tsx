"use client";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";

export function OpenDate({ classId, today }: { classId: string; today: string }) {
  const router = useRouter();
  return (
    <Field label="Điểm danh bù ngày" hint="Chọn một ngày đã qua để mở buổi điểm danh của ngày đó.">
      <input type="date" max={today} onChange={(e) => e.target.value && router.push(`/lop/${classId}/diem-danh/${e.target.value}`)}
        className="input" />
    </Field>
  );
}
