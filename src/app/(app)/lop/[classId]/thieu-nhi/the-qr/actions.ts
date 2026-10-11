"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { rotateQrToken } from "@/server/services/qr-cards";

/** Chỉ revalidate; mã mới không bao giờ được trả về client. */
export async function rotateQrTokenAction(classId: string, studentId: string) {
  const result = await rotateQrToken(db, await requireUser(), { studentId });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi/the-qr`);
  return result;
}
