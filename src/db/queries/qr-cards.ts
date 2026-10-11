import { and, asc, eq } from "drizzle-orm";
import { students } from "../schema";
import type { Db } from "../types";

export interface QrCard { studentId: string; fullName: string; saintName: string | null; token: string }

/** Nơi DUY NHẤT (cùng bảng tra của màn quét) đọc `qr_token`. Chỉ gọi sau khi đã kiểm quyền ghi lớp. */
export function listQrCards(db: Db, classId: string): Promise<QrCard[]> {
  return db
    .select({ studentId: students.id, fullName: students.fullName, saintName: students.saintName, token: students.qrToken })
    .from(students)
    .where(and(eq(students.classId, classId), eq(students.active, true)))
    .orderBy(asc(students.fullName));
}
