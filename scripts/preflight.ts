import { readFileSync } from "node:fs";
import postgres from "postgres";
import { postgresOptionsFromEnv, sanitizeDatabaseUrl } from "../src/db/connection-options";
import { errorSummary } from "../src/lib/error-summary";
import { checkEnv, migrationStatus, summarize, timezoneCheck, type Check } from "../src/lib/preflight/checks";
import { appliedMigrationCount, journalCount } from "../src/lib/preflight/db";

/**
 * Kiểm tra trước khi triển khai: biến môi trường, kết nối DB và migration đã đủ chưa.
 * Chạy: `pnpm preflight` (đọc .env.local) hoặc `pnpm preflight --prod` (coi như production: DATABASE_URL không được là localhost).
 * Không bao giờ in bí mật hay chuỗi kết nối đầy đủ. Thoát mã khác 0 nếu có mục thất bại.
 */
const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const ICON = { ok: "[ĐẠT]", warn: "[CẢNH BÁO]", fail: "[LỖI]", info: "[GHI CHÚ]" } as const;

async function dbChecks(): Promise<Check[]> {
  const url = process.env.DATABASE_URL as string;
  const sql = postgres(sanitizeDatabaseUrl(url), { ...postgresOptionsFromEnv(process.env), max: 1 });
  try {
    await sql`select 1`;
    const out: Check[] = [{ id: "DB_CONNECT", level: "ok", message: "Kết nối database thành công." }];
    const applied = await appliedMigrationCount((q) => sql.unsafe(q));
    out.push(migrationStatus(journalCount(readFileSync("./drizzle/meta/_journal.json", "utf8")), applied));
    const tz = (await sql`show timezone`) as unknown as { TimeZone?: string }[];
    out.push(timezoneCheck(tz[0]?.TimeZone));
    return out;
  } catch (e) {
    return [{ id: "DB_CONNECT", level: "fail", message: `Không kết nối/đọc được database. ${errorSummary(e)}` }];
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

async function main() {
  console.log(`Preflight (${prod ? "production" : "phát triển"})`);
  const checks = checkEnv(process.env, { prod });
  const envBlocked = checks.some((c) => c.level === "fail" && c.id === "DATABASE_URL");
  const all = envBlocked ? checks : [...checks, ...(await dbChecks())];
  for (const c of all) console.log(`${ICON[c.level]} ${c.message}`);
  const s = summarize(all);
  console.log(`\nKết quả: ${s.ok} đạt, ${s.warn} cảnh báo, ${s.fail} lỗi.`);
  if (s.failed) {
    console.log("CHƯA SẴN SÀNG: sửa các mục [LỖI] ở trên rồi chạy lại.");
    process.exit(1);
  }
  console.log(s.warn > 0 ? `Sẵn sàng (không có lỗi), nhưng có ${s.warn} cảnh báo: hãy đọc lại các mục [CẢNH BÁO].` : "Sẵn sàng.");
}

main().catch((e) => {
  console.error(errorSummary(e));
  process.exit(1);
});
