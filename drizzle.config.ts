import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Migration nên chạy qua kết nối trực tiếp/session (không qua pooler giao dịch): ưu tiên DATABASE_URL_UNPOOLED nếu có.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
