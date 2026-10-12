import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { createHealthHandler, versionFromEnv } from "@/server/http/health";

// Công khai có chủ đích (giám sát/kiểm tra sau deploy): không đọc phiên, không dữ liệu người dùng. Xem ALLOW_ROUTES trong auth-guard.test.ts.
export const dynamic = "force-dynamic";

// Một bộ xử lý cho cả instance: nhớ kết quả ~5 giây để không tạo tải lên DB khi bị gọi dồn dập.
const handler = createHealthHandler({ checkDb: () => db.execute(sql`select 1`), version: versionFromEnv(process.env) });

export const GET = () => handler();
