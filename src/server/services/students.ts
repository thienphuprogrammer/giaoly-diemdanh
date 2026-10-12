import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getStudent } from "@/db/queries/students";
import { students } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { maskPhone, redactText } from "@/lib/audit/events";
import { MAX_IMPORT_ROWS } from "@/lib/import/csv";
import { studentFields } from "@/lib/students/schema";
import { recordAudit, writeWithAudit } from "../audit";
import { NOT_FOUND, guardClass } from "../guard";
import { fail, ok, type ActionResult } from "../result";

const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
const NOT_FOUND_STUDENT = "Không tìm thấy thiếu nhi";

export async function addStudent(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = studentFields.extend({ classId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { classId, ...fields } = p.data;
  if (!(await guardClass(db, user, classId, "write"))) return fail(NOT_FOUND);
  const id = crypto.randomUUID(); // id sinh trước để dòng nhật ký cùng câu lệnh biết em vừa tạo
  await writeWithAudit(db, db.insert(students).values({ id, classId, ...fields }).returning({ id: students.id }), {
    actorId: user.id, classId, entity: "student", entityId: id, action: "student.create",
    summary: { studentName: redactText(fields.fullName) },
  });
  return ok({ id });
}

type StudentRow = NonNullable<Awaited<ReturnType<typeof getStudent>>>;
type Editable = Pick<StudentRow, "fullName" | "saintName" | "birthDate" | "parentPhone" | "note">;
/** Trường nào hiện ra giá trị trong nhật ký: tên (che chuỗi giống SĐT/mã) và SĐT đã che; ngày sinh, ghi chú chỉ được liệt kê. */
const shownInAudit: Partial<Record<keyof Editable, (v: string | null) => string | null>> = {
  fullName: (v) => (v === null ? null : redactText(v)),
  saintName: (v) => (v === null ? null : redactText(v)),
  parentPhone: maskPhone,
};

/** `summary` của một lần sửa em: danh sách trường đổi và trước/sau của các trường được phép hiện; null = không đổi gì. */
function studentChange(before: StudentRow, after: Partial<Editable>) {
  const changed = (Object.keys(after) as (keyof Editable)[]).filter((k) => (after[k] ?? null) !== before[k]);
  if (changed.length === 0) return null;
  const pick = (src: Partial<Editable>) => Object.fromEntries(changed.flatMap((k) => {
    const show = shownInAudit[k];
    return show ? [[k, show(src[k] ?? null)]] : [];
  }));
  return { studentName: redactText(after.fullName ?? before.fullName), changed, before: pick(before), after: pick(after) };
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
  const student = await loadWritable(db, user, studentId);
  if (!student) return fail(NOT_FOUND_STUDENT);
  const next: Editable = {
    fullName: fields.fullName,
    saintName: fields.saintName ?? null,
    birthDate: fields.birthDate ?? null,
    parentPhone: fields.parentPhone ?? null,
    note: fields.note ?? null,
  };
  const change = studentChange(student, next);
  if (!change) return ok(undefined); // không đổi gì: không ghi, không nhật ký
  await writeWithAudit(db, db.update(students).set(next).where(eq(students.id, studentId)).returning({ id: students.id }), {
    actorId: user.id, classId: student.classId, entity: "student", entityId: studentId, action: "student.update", summary: change,
  });
  return ok(undefined);
}

/** Chỉ sửa ghi chú và SĐT phụ huynh (trang hồ sơ); quyền ghi như `updateStudent`. */
export async function updateStudentContact(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = studentFields.pick({ parentPhone: true, note: true }).extend({ studentId: z.string() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { studentId, parentPhone, note } = p.data;
  const student = await loadWritable(db, user, studentId);
  if (!student) return fail(NOT_FOUND_STUDENT);
  const next = { parentPhone: parentPhone ?? null, note: note ?? null };
  const change = studentChange(student, next);
  if (!change) return ok(undefined);
  await writeWithAudit(db, db.update(students).set(next).where(eq(students.id, studentId)).returning({ id: students.id }), {
    actorId: user.id, classId: student.classId, entity: "student", entityId: studentId, action: "student.contact_update", summary: change,
  });
  return ok(undefined);
}

export async function setStudentActive(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ studentId: z.string(), active: z.boolean() }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const student = await loadWritable(db, user, p.data.studentId);
  if (!student) return fail(NOT_FOUND_STUDENT);
  const { active } = p.data;
  if (student.active === active) return ok(undefined);
  await writeWithAudit(db, db.update(students).set({ active })
    .where(and(eq(students.id, student.id), ne(students.active, active))).returning({ id: students.id }), {
    actorId: user.id, classId: student.classId, entity: "student", entityId: student.id,
    action: active ? "student.reactivate" : "student.deactivate", summary: { studentName: redactText(student.fullName) },
  });
  return ok(undefined);
}

export async function importStudents(
  db: Db,
  user: AppUser,
  input: unknown,
): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  const p = z.object({
    classId: z.string(),
    rows: z.array(studentFields).max(MAX_IMPORT_ROWS, `Tối đa ${MAX_IMPORT_ROWS} dòng mỗi lần nhập`),
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  const { classId, rows } = p.data;
  if (!(await guardClass(db, user, classId, "write"))) return fail(NOT_FOUND);

  const key = (r: { fullName: string; birthDate?: string | null }) =>
    `${r.fullName.normalize("NFC").trim().toLowerCase()}|${r.birthDate ?? ""}`;
  const unique = [...new Map(rows.map((r) => [key(r), r] as const).reverse()).values()].reverse();
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${classId}))`);
    const existing = new Set((await tx.select({ fullName: students.fullName, birthDate: students.birthDate }).from(students).where(eq(students.classId, classId))).map(key));
    const fresh = unique.filter((r) => !existing.has(key(r)));
    if (fresh.length > 0) {
      await tx.insert(students).values(fresh.map((r) => ({ classId, ...r })));
      await recordAudit(tx, {
        actorId: user.id, classId, entity: "student", action: "student.import",
        summary: { count: fresh.length, skipped: rows.length - fresh.length },
      });
    }
    return fresh.length;
  });
  return ok({ inserted, skipped: rows.length - inserted });
}
