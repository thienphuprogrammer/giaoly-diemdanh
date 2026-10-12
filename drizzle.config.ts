import { defineConfig } from "drizzle-kit";
import { databaseUrlFromEnv, sanitizeDatabaseUrl } from "./src/db/connection-options";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Migration nên chạy qua kết nối trực tiếp/session (không qua pooler giao dịch): ưu tiên DATABASE_URL_UNPOOLED nếu có.
  dbCredentials: { url: sanitizeDatabaseUrl(databaseUrlFromEnv(process.env)) },
});
