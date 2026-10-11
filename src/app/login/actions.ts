"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { authenticate } from "@/lib/auth/authenticate";
import { createSession } from "@/lib/auth/dal";

const schema = z.object({
  email: z.email("Email không hợp lệ"),
  password: z.string().min(1, "Nhập mật khẩu"),
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
  await createSession(result.userId);
  redirect("/");
}
