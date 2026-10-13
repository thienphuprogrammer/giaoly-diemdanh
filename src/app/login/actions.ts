"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { authenticate } from "@/lib/auth/authenticate";
import { createSession } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/next-path";

const schema = z.object({
  email: z.string().trim().pipe(z.email("Email không hợp lệ")),
  password: z.string().min(1, "Nhập mật khẩu").max(72, "Mật khẩu quá dài"),
});

export async function login(_prev: { error?: string } | undefined, formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const result = await authenticate(db, parsed.data);
  if (!result.ok) {
    return {
      error:
        result.reason === "locked"
          ? "Đăng nhập sai quá nhiều lần. Thử lại sau 15 phút."
          : "Email hoặc mật khẩu không đúng",
    };
  }
  await createSession(result.userId, undefined, result.sessionVersion);
  // `next` từ form là dữ liệu client: chỉ nhận đường dẫn nội bộ an toàn, còn lại về trang chủ.
  redirect(safeNextPath(formData.get("next")));
}
