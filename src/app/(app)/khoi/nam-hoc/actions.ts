"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import type { ActionResult } from "@/server/result";
import { setNextGrade } from "@/server/services/grade-settings";
import { applyPromotion, previewPromotion, undoPromotion, type PromotionPreview, type PromotionResult } from "@/server/services/promotions";
import { createSchoolYear } from "@/server/services/school-years";

const PAGE = "/khoi/nam-hoc";
const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

/** Form "Tạo năm học": hai học kỳ, ô ngày dạng YYYY-MM-DD. */
export async function createSchoolYearAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const term = (n: 1 | 2) => ({ name: text(fd, `term${n}Name`), startsOn: text(fd, `term${n}Start`), endsOn: text(fd, `term${n}End`) });
  const result = await createSchoolYear(db, user, { name: text(fd, "name"), term1: term(1), term2: term(2) });
  if (result.ok) {
    revalidatePath(PAGE);
    revalidatePath("/khoi");
  }
  return toFormState(result);
}

export async function setNextGradeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await setNextGrade(db, user, { gradeId: text(fd, "gradeId"), nextGradeId: text(fd, "nextGradeId") });
  if (result.ok) revalidatePath(PAGE);
  return toFormState(result);
}

export async function previewPromotionAction(input: { fromClassId: string; toClassId: string }): Promise<ActionResult<PromotionPreview>> {
  const user = await requireUser();
  return previewPromotion(db, user, input);
}

export async function applyPromotionAction(input: {
  fromClassId: string; toClassId: string; studentIds: string[]; clientToken: string;
}): Promise<ActionResult<PromotionResult>> {
  const user = await requireUser();
  const result = await applyPromotion(db, user, input);
  if (result.ok) {
    revalidatePath(PAGE);
    revalidatePath("/khoi");
  }
  return result;
}

export async function undoPromotionAction(input: { promotionId: string }): Promise<ActionResult<{ restored: number; notRestored: number }>> {
  const user = await requireUser();
  const result = await undoPromotion(db, user, input);
  if (result.ok) {
    revalidatePath(PAGE);
    revalidatePath("/khoi");
  }
  return result;
}
