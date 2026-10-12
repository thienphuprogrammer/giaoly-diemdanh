/** Phần đọc dữ liệu của preflight, tách khỏi mạng/DB thật: nhận hàm chạy SQL để test bằng PGlite. */

export type RunSql = (query: string) => Promise<readonly unknown[]>;

/** Số migration trong mã: số dòng `entries` của drizzle/meta/_journal.json. */
export function journalCount(journalJson: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(journalJson);
  } catch {
    throw new Error("Không đọc được drizzle/meta/_journal.json (journal hỏng)");
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) throw new Error("drizzle/meta/_journal.json không có danh sách entries (journal hỏng)");
  return entries.length;
}

// 42P01: bảng chưa có; 3F000: schema `drizzle` chưa có. Cả hai nghĩa là chưa từng chạy migration.
const NO_MIGRATION_TABLE = new Set(["42P01", "3F000"]);

/** Số migration đã áp dụng trong DB; 0 nếu chưa từng migrate. Lỗi khác (mạng, quyền) ném lại. */
export async function appliedMigrationCount(run: RunSql): Promise<number> {
  try {
    const rows = await run("select count(*)::int as n from drizzle.__drizzle_migrations");
    return Number((rows[0] as { n?: unknown } | undefined)?.n ?? 0);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && NO_MIGRATION_TABLE.has(code)) return 0;
    throw err;
  }
}
