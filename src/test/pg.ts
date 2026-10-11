import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

/**
 * Postgres thật cho test đua (PGlite chỉ có một kết nối nên không đua thật được).
 * Dùng database riêng `<tên DB E2E>_conc` trên cùng máy chủ để không đụng dữ liệu E2E;
 * tên phải chứa "e2e" (chống chạy nhầm vào DB thật). Mỗi lần gọi xóa sạch và migrate lại.
 */
export const realPgUrl = process.env.E2E_DATABASE_URL;

export async function createRealPgDb(poolSize = 10): Promise<{ db: Db; close: () => Promise<void> }> {
  if (!realPgUrl) throw new Error("Thiếu E2E_DATABASE_URL");
  const base = new URL(realPgUrl);
  const name = `${base.pathname.slice(1)}_conc`;
  if (!/e2e/i.test(name) || !/^[a-z0-9_]+$/i.test(name)) throw new Error("Tên database test đua phải chứa 'e2e' và chỉ gồm chữ, số, gạch dưới");

  const admin = postgres(realPgUrl, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const url = new URL(realPgUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: poolSize, onnotice: () => {} });
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Db, close: () => sql.end() };
}
