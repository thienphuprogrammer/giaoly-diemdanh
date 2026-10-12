import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { resolveTerm } from "@/db/queries/stats";
import { studentTermRecords } from "@/db/queries/student-profile";
import { getStudent } from "@/db/queries/students";
import type { Db } from "@/db/types";
import { canAccess, type AppUser } from "@/lib/access/can-access";
import { summarize, type StudentSummary } from "@/lib/attendance/summary";

export type ProfileStudent = NonNullable<Awaited<ReturnType<typeof getStudent>>>;

export interface StudentProfile {
  student: ProfileStudent;
  canWrite: boolean;
  term: { id: string; name: string } | null;
  summary: StudentSummary;
  /** (có mặt + muộn) / số buổi đã điểm danh; null khi chưa có buổi nào. */
  rate: number | null;
  records: Awaited<ReturnType<typeof studentTermRecords>>;
}

/** null cho mọi trường hợp không xem được (id sai, em không thuộc lớp, ngoài quyền đọc) để không lộ em/lớp có thật. */
export async function getStudentProfile(
  db: Db,
  user: AppUser,
  input: { classId: string; studentId: string; today: string },
): Promise<StudentProfile | null> {
  const { classId, studentId, today } = input;
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(studentId).success) return null;
  const [cls, student] = await Promise.all([getAccessClass(db, classId), getStudent(db, studentId)]);
  if (!cls || !student || student.classId !== classId || !canAccess(user, cls, "read")) return null;
  const term = await resolveTerm(db, undefined, today);
  const records = term ? await studentTermRecords(db, studentId, term.id) : [];
  const summary = summarize(records);
  return {
    student,
    canWrite: canAccess(user, cls, "write"),
    term: term ? { id: term.id, name: term.name } : null,
    summary,
    rate: summary.marked === 0 ? null : (summary.present + summary.late) / summary.marked,
    records,
  };
}
