"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import * as seating from "@/server/services/seating";

const path = (classId: string) => `/lop/${classId}/so-do`;

export async function createPlanAction(classId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const result = await seating.createPlan(db, await requireUser(), { ...Object.fromEntries(formData), classId });
  if (!result.ok) return toFormState(result);
  revalidatePath(path(classId));
  redirect(`${path(classId)}?plan=${result.data.id}`);
}

export async function applyTemplateAction(classId: string, input: unknown) {
  const result = await seating.applyTemplate(db, await requireUser(), input);
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function saveLayoutAction(classId: string, input: unknown) {
  const result = await seating.saveLayout(db, await requireUser(), input);
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function assignSeatAction(classId: string, input: unknown) {
  const result = await seating.assignSeat(db, await requireUser(), input);
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function activatePlanAction(classId: string, planId: string) {
  const result = await seating.activatePlan(db, await requireUser(), { planId });
  if (result.ok) revalidatePath(path(classId));
  return result;
}

export async function deletePlanAction(classId: string, planId: string) {
  const result = await seating.deletePlan(db, await requireUser(), { planId });
  if (result.ok) revalidatePath(path(classId));
  return result;
}
