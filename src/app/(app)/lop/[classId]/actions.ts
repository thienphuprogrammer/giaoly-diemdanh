"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { setClassSchedule } from "@/server/services/class-schedule";

/** Đặt/xoá lịch học của lớp (GLV được phân công hoặc trưởng khối). Nút "Xoá lịch" gửi `clear`. */
export async function setClassScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const clear = fd.get("intent") === "clear";
  const classId = fd.get("classId");
  const result = await setClassSchedule(db, user, {
    classId, meetsOn: clear ? null : fd.get("meetsOn"), meetsAt: clear ? null : fd.get("meetsAt"),
  });
  if (result.ok && typeof classId === "string") revalidatePath(`/lop/${classId}`);
  return toFormState(result);
}
