import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu biến môi trường DATABASE_URL");

const globalForSql = globalThis as unknown as { __sql?: ReturnType<typeof postgres> };
const sql = globalForSql.__sql ?? postgres(url, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForSql.__sql = sql;

export const db: Db = drizzle(sql, { schema });
