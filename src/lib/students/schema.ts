import { z } from "@/lib/zod";
import { optionalDate, optionalPhone, optionalText } from "@/lib/validation";

export const studentFields = z.object({
  fullName: z.string().trim().min(1, "Nhập họ tên").max(120, "Họ tên quá dài"),
  saintName: optionalText(60),
  birthDate: optionalDate,
  parentPhone: optionalPhone,
  note: optionalText(500),
});
export type StudentFields = z.output<typeof studentFields>;
