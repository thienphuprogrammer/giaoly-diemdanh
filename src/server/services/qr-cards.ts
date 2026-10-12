import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listQrCards, type QrCard } from "@/db/queries/qr-cards";
import { getStudent } from "@/db/queries/students";
import { students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { redactText } from "@/lib/audit/events";
import { writeWithAudit } from "../audit";
import { guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";

export async function getQrCards(db: Db, user: AppUser, classId: string): Promise<QrCard[] | null> {
  if (!(await guardClass(db, user, classId, "write"))) return null;
  return listQrCards(db, classId);
}

/** Cấp mã mới cho đúng một em (khi mất thẻ); thẻ cũ vô hiệu ngay. Mã mới do database sinh. */
export async function rotateQrToken(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ studentId: z.string() }).safeParse(input);
  if (!p.success || !z.uuid().safeParse(p.data.studentId).success) return fail(NOT_FOUND_STUDENT);
  const student = await getStudent(db, p.data.studentId);
  if (!student || !(await guardClass(db, user, student.classId, "write"))) return fail(NOT_FOUND_STUDENT);
  // Nhật ký chỉ có tên em: không bao giờ mã cũ/mới (RETURNING chỉ lấy id).
  await writeWithAudit(db, db.update(students).set({ qrToken: sql`replace(gen_random_uuid()::text, '-', '')` })
    .where(eq(students.id, student.id)).returning({ id: students.id }), {
    actorId: user.id, classId: student.classId, entity: "student", entityId: student.id, action: "student.qr_rotate",
    summary: { studentName: redactText(student.fullName) },
  });
  return ok(undefined);
}
