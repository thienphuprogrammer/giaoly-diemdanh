import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

// `any` cho query-result HKT để cả postgres-js (production) lẫn PGlite (test) đều gán được.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
