import { z } from "zod";
import { PHONE_ERROR, normalizePhone } from "@/lib/phone";

const blankToUndefined = <T>(v: T | "" | undefined): T | undefined => (v === "" ? undefined : v);

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Tối đa ${max} ký tự`).optional().transform(blankToUndefined);

export const optionalDate = z
  .union([z.literal(""), z.iso.date("Ngày sinh không hợp lệ")])
  .optional()
  .transform(blankToUndefined);

/** Rỗng -> undefined; ngược lại chuẩn hoá về dạng trong nước ("0901234567") hoặc báo lỗi. */
export const optionalPhone = z
  .string()
  .max(40, PHONE_ERROR)
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v.trim() === "") return undefined;
    const r = normalizePhone(v);
    if (r.ok) return r.value;
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  });
