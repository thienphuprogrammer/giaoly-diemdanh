import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { handleHealth, versionFromEnv } from "@/server/http/health";

// Công khai có chủ đích (giám sát/kiểm tra sau deploy): không đọc phiên, không dữ liệu người dùng. Xem ALLOW_ROUTES trong auth-guard.test.ts.
export const dynamic = "force-dynamic";

export const GET = () => handleHealth({ checkDb: () => db.execute(sql`select 1`), version: versionFromEnv(process.env) });
