"use server";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import * as mass from "@/server/services/mass";

// Tích đi lễ trên bảng điểm danh: như các lần chạm điểm danh, không revalidate (client giữ trạng thái lạc quan,
// trang thống kê là dynamic nên luôn đọc mới).
export async function setMassStatusAction(input: unknown) {
  return mass.setMassStatus(db, await requireUser(), input);
}
export async function markClassAtMassAction(input: unknown) {
  return mass.markClassAtMass(db, await requireUser(), input);
}
export async function undoClassAtMassAction(input: unknown) {
  return mass.undoClassAtMass(db, await requireUser(), input);
}
