"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import * as attendance from "@/server/services/attendance";

// Không revalidate mỗi lần chạm: client giữ trạng thái lạc quan; các trang thống kê là dynamic nên luôn đọc mới.
export async function setStatusAction(input: unknown) {
  return attendance.setStatus(db, await requireUser(), input);
}
export async function markAllPresentAction(input: unknown) {
  return attendance.markAllPresent(db, await requireUser(), input);
}
export async function setCancelledAction(input: unknown) {
  return attendance.setCancelled(db, await requireUser(), input);
}
export async function undoMarkAllPresentAction(input: unknown) {
  return attendance.undoMarkAllPresent(db, await requireUser(), input);
}
// Kết thúc buổi: đổi số liệu "vắng không phép" của nhiều em nên làm mới cache router để thống kê/cảnh báo đọc lại.
export async function markRemainingAbsentAction(input: unknown) {
  const result = await attendance.markRemainingAbsent(db, await requireUser(), input);
  if (result.ok && result.data.marked > 0) revalidatePath("/", "layout");
  return result;
}
