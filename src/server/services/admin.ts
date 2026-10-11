import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAccessClass } from "@/db/queries/access";
import { classCatechists, classes, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { canManageGrade, type AppUser } from "@/lib/access/can-access";
import { hashPassword } from "@/lib/auth/password";
import { fail, ok, type ActionResult } from "../result";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
const firstError = (e: z.ZodError) => e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
// bcrypt cắt mọi ký tự sau 72 byte nên giới hạn ở 72.
const password = z.string().min(10, "Mật khẩu phải có ít nhất 10 ký tự").max(72, "Mật khẩu tối đa 72 ký tự");

const isHead = (user: AppUser): user is AppUser & { gradeId: string } => user.isGradeHead && !!user.gradeId;

export async function createClass(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ name: z.string().trim().min(1, "Nhập tên lớp").max(60) }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user)) return fail(FORBIDDEN);
  const dup = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.gradeId, user.gradeId), eq(classes.name, p.data.name)));
  if (dup.length > 0) return fail("Tên lớp đã tồn tại trong khối");
  const [row] = await db.insert(classes).values({ gradeId: user.gradeId, name: p.data.name }).returning({ id: classes.id });
  return ok({ id: row.id });
}

export async function createCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult<{ id: string }>> {
  const p = z.object({
    name: z.string().trim().min(1, "Nhập họ tên").max(120),
    email: z.email("Email không hợp lệ").transform((e) => e.trim().toLowerCase()),
    password,
  }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user)) return fail(FORBIDDEN);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, p.data.email));
  if (existing) return fail("Email đã được dùng");
  try {
    const [row] = await db.insert(users).values({
      name: p.data.name, email: p.data.email, gradeId: user.gradeId, isGradeHead: false,
      passwordHash: await hashPassword(p.data.password),
    }).returning({ id: users.id });
    return ok({ id: row.id });
  } catch (error) {
    console.error("createCatechist failed", error);
    return fail("Không tạo được tài khoản");
  }
}

async function loadManaged(db: Db, user: AppUser, classId: string, userId: string) {
  if (!z.uuid().safeParse(classId).success || !z.uuid().safeParse(userId).success) return null;
  const cls = await getAccessClass(db, classId);
  if (!cls || !canManageGrade(user, cls.gradeId)) return null;
  const [target] = await db.select().from(users).where(eq(users.id, userId));
  return target && target.gradeId === cls.gradeId ? { cls, target } : null;
}

const assignInput = z.object({ classId: z.string(), userId: z.string() });

export async function assignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadManaged(db, user, p.data.classId, p.data.userId))) return fail(FORBIDDEN);
  await db.insert(classCatechists).values(p.data).onConflictDoNothing();
  return ok(undefined);
}

export async function unassignCatechist(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = assignInput.safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!(await loadManaged(db, user, p.data.classId, p.data.userId))) return fail(FORBIDDEN);
  await db.delete(classCatechists).where(and(eq(classCatechists.classId, p.data.classId), eq(classCatechists.userId, p.data.userId)));
  return ok(undefined);
}

export async function resetPassword(db: Db, user: AppUser, input: unknown): Promise<ActionResult> {
  const p = z.object({ userId: z.string(), password }).safeParse(input);
  if (!p.success) return fail(firstError(p.error));
  if (!isHead(user) || !z.uuid().safeParse(p.data.userId).success) return fail(FORBIDDEN);
  const [target] = await db.select().from(users).where(eq(users.id, p.data.userId));
  if (!target || target.gradeId !== user.gradeId || target.isGradeHead) return fail(FORBIDDEN);
  await db.update(users).set({ passwordHash: await hashPassword(p.data.password) }).where(eq(users.id, target.id));
  return ok(undefined);
}
