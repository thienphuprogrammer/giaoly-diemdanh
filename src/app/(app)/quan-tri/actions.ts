"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { fail, type ActionResult } from "@/server/result";
import {
  assignAccountToClass, createAccount, createGrade, createSystemClass, deleteGrade, deleteSystemClass,
  resetAccountPassword, setAccountActive, unassignAccountFromClass, updateAccount, updateGrade, updateSystemClass,
} from "@/server/services/system-admin";
import { createSchoolYear, deleteSchoolYear, renameSchoolYear } from "@/server/services/school-years";
import { applyPromotion, previewPromotion, undoPromotion, type PromotionPreview, type PromotionResult } from "@/server/services/promotions";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";

const text = (fd: FormData, key: string): string => {
  const value = fd.get(key);
  return typeof value === "string" ? value : "";
};
const forbidden = () => fail("Bạn không có quyền quản trị hệ thống");

/** Every action reloads the actor before passing validated input to the guarded service. */
export async function administerAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.isAdmin) return toFormState(forbidden());
  const input = {
    userId: text(fd, "userId"), classId: text(fd, "classId"), gradeId: text(fd, "gradeId") || null,
    name: text(fd, "name"), email: text(fd, "email"), role: text(fd, "role"),
  };
  // Step-up: the acting admin's own password, verified (with lockout) by the service when the operation requires it.
  const currentPassword = text(fd, "currentPassword");
  let result: ActionResult<unknown>;
  switch (text(fd, "intent")) {
    case "create-account": result = await createAccount(db, user, { ...input, password: text(fd, "password"), currentPassword }); break;
    case "update-account": result = await updateAccount(db, user, { ...input, currentPassword }); break;
    case "set-account-active": result = await setAccountActive(db, user, { userId: input.userId, isActive: text(fd, "isActive") === "true", currentPassword }); break;
    case "reset-account-password": result = await resetAccountPassword(db, user, { userId: input.userId, password: text(fd, "password"), currentPassword }); break;
    case "create-grade": result = await createGrade(db, user, { name: input.name, massThreshold: Number(text(fd, "massThreshold")) }); break;
    case "update-grade": result = await updateGrade(db, user, { gradeId: input.gradeId, name: input.name, massThreshold: Number(text(fd, "massThreshold")), nextGradeId: text(fd, "nextGradeId") || null }); break;
    case "delete-grade": result = await deleteGrade(db, user, { gradeId: input.gradeId }); break;
    case "create-class": result = await createSystemClass(db, user, { name: input.name, gradeId: input.gradeId, schoolYearId: text(fd, "schoolYearId") }); break;
    case "update-class": result = await updateSystemClass(db, user, { classId: input.classId, name: input.name, gradeId: input.gradeId }); break;
    case "delete-class": result = await deleteSystemClass(db, user, { classId: input.classId }); break;
    case "assign-account": result = await assignAccountToClass(db, user, { classId: input.classId, userId: input.userId }); break;
    case "unassign-account": result = await unassignAccountFromClass(db, user, { classId: input.classId, userId: input.userId }); break;
    case "rename-school-year": result = await renameSchoolYear(db, user, { schoolYearId: text(fd, "schoolYearId"), name: input.name }); break;
    default: return { error: "Thao tác không hợp lệ" };
  }
  if (result.ok) revalidatePath("/", "layout");
  return toFormState(result);
}

export async function createAdminSchoolYearAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.isAdmin) return toFormState(forbidden());
  const term = (n: 1 | 2) => ({ name: text(fd, `term${n}Name`), startsOn: text(fd, `term${n}Start`), endsOn: text(fd, `term${n}End`) });
  const result = await createSchoolYear(db, user, { name: text(fd, "name"), term1: term(1), term2: term(2) });
  if (result.ok) revalidatePath("/", "layout");
  return toFormState(result);
}

export async function deleteAdminSchoolYearAction(input: { schoolYearId: string }): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.isAdmin) return forbidden();
  const result = await deleteSchoolYear(db, user, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function previewAdminPromotionAction(input: { fromClassId: string; toClassId: string }): Promise<ActionResult<PromotionPreview>> {
  const user = await requireUser();
  if (!user.isAdmin) return forbidden();
  return previewPromotion(db, user, input);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function promotionMutation<T>(user: AppUser, operation: (tx: Tx, actor: AppUser) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  if (!user.isAdmin) return forbidden();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
    const [actor] = await tx.select({ id: users.id, email: users.email, name: users.name, isAdmin: users.isAdmin, sessionVersion: users.sessionVersion, isGradeHead: users.isGradeHead, gradeId: users.gradeId, isActive: users.isActive }).from(users).where(eq(users.id, user.id));
    if (!actor?.isAdmin || !actor.isActive || actor.sessionVersion !== user.sessionVersion) return forbidden();
    return operation(tx, actor);
  });
}

export async function applyAdminPromotionAction(input: { fromClassId: string; toClassId: string; studentIds: string[]; clientToken: string }): Promise<ActionResult<PromotionResult>> {
  const user = await requireUser();
  const result = await promotionMutation(user, (tx, actor) => applyPromotion(tx, actor, input));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function undoAdminPromotionAction(input: { promotionId: string }): Promise<ActionResult<{ restored: number; notRestored: number }>> {
  const user = await requireUser();
  const result = await promotionMutation(user, (tx, actor) => undoPromotion(tx, actor, input));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
