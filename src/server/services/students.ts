import { eq } from "drizzle-orm";
import { z } from "zod";
import { getStudent } from "@/db/queries/students";
import { students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { studentFields } from "@/lib/students/schema";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";

export async function addStudent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = studentFields.extend({ classId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { classId, ...fields } = p.data;
  if (!(await guardClass(db, user, classId, "write"))) return fail(NOT_FOUND);
  const [row] = await db.insert(students).values({ classId, ...fields }).returning({ id: students.id });
  return ok({ id: row.id });
}

async function loadWritable(db: Db, user: AppUser, studentId: string) {
  if (!z.uuid().safeParse(studentId).success) return null;
  const student = await getStudent(db, studentId);
  if (!student || !(await guardClass(db, user, student.classId, "write"))) return null;
  return student;
}

export async function updateStudent(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = studentFields.extend({ studentId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { studentId, ...fields } = p.data;
  if (!(await loadWritable(db, user, studentId))) return fail(NOT_FOUND_STUDENT);
  await db.update(students).set({
    fullName: fields.fullName,
    saintName: fields.saintName ?? null,
    birthDate: fields.birthDate ?? null,
    parentPhone: fields.parentPhone ?? null,
    note: fields.note ?? null,
  }).where(eq(students.id, studentId));
  return ok(undefined);
}

export async function setStudentActive(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ studentId: z.string(), active: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadWritable(db, user, p.data.studentId))) return fail(NOT_FOUND_STUDENT);
  await db.update(students).set({ active: p.data.active }).where(eq(students.id, p.data.studentId));
  return ok(undefined);
}
