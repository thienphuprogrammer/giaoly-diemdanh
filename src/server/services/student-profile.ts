import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { massGrid } from "@/db/queries/mass-stats";
import { resolveTerm } from "@/db/queries/stats";
import { studentTermRecords } from "@/db/queries/student-profile";
import { getStudent, wasStudentInClass } from "@/db/queries/students";
import { getClassById } from "@/db/queries/classes";
import type { Db } from "@/db/types";
import { canAccess, type AppUser } from "@/lib/access/can-access";
import { isMassWarning, tallyMass } from "@/lib/attendance/mass-tally";
import { summarize, type StudentSummary } from "@/lib/attendance/summary";

export type ProfileStudent = NonNullable<Awaited<ReturnType<typeof getStudent>>>;

export interface StudentProfile {
  student: ProfileStudent;
  canWrite: boolean;
  former: boolean;
  term: { id: string; name: string } | null;
  summary: StudentSummary;
  /** (có mặt + muộn) / số buổi đã điểm danh; null khi chưa có buổi nào. */
  rate: number | null;
  records: Awaited<ReturnType<typeof studentTermRecords>>;
  /** Khối "Đi lễ" (spec §1b), tính riêng với chuyên cần buổi học; null khi chưa có học kỳ. */
  mass: StudentMass | null;
}

export interface StudentMass {
  threshold: number;
  counted: number;
  attended: number;
  missed: number;
  warning: boolean;
  /** Các tuần đã ghi nhận được tính cho em (từ lần đầu em có dòng điểm danh ở lớp), mới nhất trước. */
  weeks: { sessionId: string; heldOn: string; attended: boolean }[];
}

async function studentMass(db: Db, classId: string, studentId: string, termId: string, former: boolean): Promise<StudentMass | null> {
  const grid = await massGrid(db, { classIds: [classId], termId, studentId, includeFormer: former });
  const me = grid.students[0];
  if (!me) return null;
  const all = grid.weeks.get(classId) ?? [];
  const t = tallyMass(all, me.firstSeen, me.attended);
  const weeks = all
    .map((w, i) => ({ ...w, cell: t.cells[i] }))
    .filter((w) => w.cell !== "not_counted")
    .map((w) => ({ sessionId: w.sessionId, heldOn: w.heldOn, attended: w.cell === "attended" }))
    .reverse();
  return { threshold: me.threshold, counted: t.counted, attended: t.attended, missed: t.missed, warning: isMassWarning(t.missed, me.threshold), weeks };
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
  if (!cls || !student || !canAccess(user, cls, "read")) return null;
  const former = student.classId !== classId;
  if (former && !(await wasStudentInClass(db, studentId, classId))) return null;
  const info = await getClassById(db, classId);
  if (!info) return null;
  const term = await resolveTerm(db, undefined, today, info.schoolYearId);
  const [records, mass] = term
    ? await Promise.all([studentTermRecords(db, studentId, term.id, former ? classId : undefined), studentMass(db, classId, studentId, term.id, former)])
    : [[], null];
  const summary = summarize(records);
  return {
    student,
    canWrite: !former && canAccess(user, cls, "write"), former,
    term: term ? { id: term.id, name: term.name } : null,
    summary,
    rate: summary.marked === 0 ? null : (summary.present + summary.late) / summary.marked,
    records,
    mass,
  };
}
