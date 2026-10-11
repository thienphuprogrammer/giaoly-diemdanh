import type { ActionResult } from "./result";

export type FormState = { error?: string; ok?: boolean } | undefined;

export function toFormState(result: ActionResult<unknown>): FormState {
  return result.ok ? { ok: true } : { error: result.error };
}
