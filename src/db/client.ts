import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

const globalForSql = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };

function connect(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu biến môi trường DATABASE_URL");
  const sql = globalForSql.__sql ?? postgres(url, { max: 5 });
  if (process.env.NODE_ENV !== "production") globalForSql.__sql = sql;
  return drizzle(sql, { schema });
}

let instance: Db | undefined;

/**
 * Kết nối được tạo lười ở lần truy vấn đầu tiên: `next build` không cần DATABASE_URL,
 * chỉ lúc chạy thật mới cần (thiếu biến thì lần truy vấn đầu báo lỗi rõ ràng).
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    instance ??= connect();
    const value: unknown = Reflect.get(instance, prop);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
