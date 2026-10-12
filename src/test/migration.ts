import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

interface Journal { entries: { tag: string }[] }

/** Migration thêm thẻ QR (backfill mã cho em đã có). Ghim theo tên để thêm migration mới không đổi test backfill. */
export const QR_MIGRATION = "0002_qr_cards_and_scans";
/** Migration thêm `sessions.kind` (buổi đi lễ) và `grades.mass_threshold`. */
export const MASS_MIGRATION = "0003_mass_sessions";

const sqlOf = (tag: string) =>
  readFileSync(`./drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

/** DB PGlite đã chạy mọi migration TRƯỚC `tag`; `apply()` chạy đúng migration `tag` (không chạy các bản sau). */
export async function createTestDbBeforeMigration(tag: string) {
  const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as Journal;
  const tags = journal.entries.map((e) => e.tag);
  const at = tags.indexOf(tag);
  if (at < 0) throw new Error(`Không có migration ${tag}`);
  const client = new PGlite();
  for (const t of tags.slice(0, at)) for (const stmt of sqlOf(t)) await client.exec(stmt);
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    client,
    async apply() { for (const stmt of sqlOf(tag)) await client.exec(stmt); },
  };
}
