"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { toFormState, type FormState } from "@/server/form-state";
import { assignCatechist, createCatechist, createClass, resetPassword, unassignCatechist } from "@/server/services/admin";
import type { AppUser } from "@/lib/access/can-access";
import type { ActionResult } from "@/server/result";
import type { Db } from "@/db/types";

type Service = (db: Db, user: AppUser, input: unknown) => Promise<ActionResult<unknown>>;

async function run(service: Service, formData: FormData): Promise<FormState> {
  const result = await service(db, await requireUser(), Object.fromEntries(formData));
  if (result.ok) revalidatePath("/khoi");
  return toFormState(result);
}

export async function createClassAction(_: FormState, fd: FormData) { return run(createClass, fd); }
export async function createCatechistAction(_: FormState, fd: FormData) { return run(createCatechist, fd); }
export async function assignAction(_: FormState, fd: FormData) { return run(assignCatechist, fd); }
export async function unassignAction(_: FormState, fd: FormData) { return run(unassignCatechist, fd); }
export async function resetPasswordAction(_: FormState, fd: FormData) { return run(resetPassword, fd); }
