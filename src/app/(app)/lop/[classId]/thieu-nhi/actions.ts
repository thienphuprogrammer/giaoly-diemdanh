"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { addStudent, importStudents, setStudentActive, updateStudent, updateStudentContact } from "@/server/services/students";

export async function addStudentAction(classId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await addStudent(db, user, { ...Object.fromEntries(formData), classId });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return toFormState(result);
}

export async function updateStudentAction(classId: string, studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updateStudent(db, user, { ...Object.fromEntries(formData), studentId });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return toFormState(result);
}

export async function updateStudentContactAction(classId: string, studentId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updateStudentContact(db, user, { ...Object.fromEntries(formData), studentId });
  if (result.ok) {
    revalidatePath(`/lop/${classId}/thieu-nhi/${studentId}`);
    revalidatePath(`/lop/${classId}/thieu-nhi`);
  }
  return toFormState(result);
}

export async function setStudentActiveAction(classId: string, studentId: string, active: boolean) {
  const user = await requireUser();
  const result = await setStudentActive(db, user, { studentId, active });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return result;
}

export async function importStudentsAction(classId: string, rows: unknown[]) {
  const user = await requireUser();
  const result = await importStudents(db, user, { classId, rows });
  if (result.ok) revalidatePath(`/lop/${classId}/thieu-nhi`);
  return result;
}
