import { z } from "zod";

const blankToUndefined = <T>(v: T | "" | undefined): T | undefined => (v === "" ? undefined : v);

export const optionalText = (max: number) =>
  z.string().trim().max(max, `Tối đa ${max} ký tự`).optional().transform(blankToUndefined);

export const optionalDate = z
  .union([z.literal(""), z.iso.date("Ngày sinh không hợp lệ")])
  .optional()
  .transform(blankToUndefined);

export const optionalPhone = z
  .union([z.literal(""), z.string().trim().regex(/^[0-9 +().-]{6,20}$/, "SĐT không hợp lệ")])
  .optional()
  .transform(blankToUndefined);
