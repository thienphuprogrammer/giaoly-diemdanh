"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import * as attendance from "@/server/services/attendance";

// Kết thúc buổi: đổi số liệu "vắng không phép" của nhiều em nên làm mới cache router để thống kê/cảnh báo đọc lại.
export async function markRemainingAbsentAction(input: unknown) {
  const result = await attendance.markRemainingAbsent(db, await requireUser(), input);
  if (result.ok && result.data.marked > 0) revalidatePath("/", "layout");
  return result;
}
