import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

interface Journal { entries: { tag: string }[] }

const sqlOf = (tag: string) =>
  readFileSync(`./drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);

export async function createTestDbBeforeLastMigration() {
  const journal = JSON.parse(readFileSync("./drizzle/meta/_journal.json", "utf8")) as Journal;
  const tags = journal.entries.map((e) => e.tag);
  const client = new PGlite();
  for (const tag of tags.slice(0, -1)) for (const stmt of sqlOf(tag)) await client.exec(stmt);
  const last = tags[tags.length - 1];
  return {
    db: drizzle(client, { schema }) as unknown as Db,
    client,
    async applyLast() { for (const stmt of sqlOf(last)) await client.exec(stmt); },
  };
}
