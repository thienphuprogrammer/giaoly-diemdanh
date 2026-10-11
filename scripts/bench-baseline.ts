import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../src/db/schema";
import type { Db } from "../src/db/types";
import { setStatus } from "../src/server/services/attendance";

const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("Thiếu E2E_DATABASE_URL");
if (!/e2e/i.test(new URL(url).pathname)) throw new Error("Tên database phải chứa 'e2e'");

const N = 200;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main() {
  let queries = 0;
  const sql = postgres(url!, { max: 5 });
  const db = drizzle(sql, { schema: s, logger: { logQuery: () => { queries++; } } }) as unknown as Db;

  const [user] = await sql`select id, email, name, grade_id, is_grade_head from users where email = 'glv-a@e2e.vn'`;
  const [cls] = await sql`select c.id from classes c join class_catechists cc on cc.class_id = c.id where cc.user_id = ${user.id} limit 1`;
  const kids = await sql`select id from students where class_id = ${cls.id} and active limit 4`;
  const [term] = await sql`select id from terms limit 1`;
  const [session] = await sql`insert into sessions (class_id, term_id, held_on) values (${cls.id}, ${term.id}, '2026-01-01') on conflict (class_id, held_on) do update set cancelled = false returning id`;
  const appUser = { id: user.id, email: user.email, name: user.name, isGradeHead: user.is_grade_head, gradeId: user.grade_id };

  const rtt: number[] = [];
  for (let i = 0; i < 50; i++) { const t = performance.now(); await sql`select 1`; rtt.push(performance.now() - t); }

  const times: number[] = [];
  queries = 0;
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    await setStatus(db, appUser, { sessionId: session.id, studentId: kids[i % kids.length].id, status: i % 2 ? "present" : "absent_unexcused", reason: null });
    times.push(performance.now() - t);
  }
  console.log(JSON.stringify({
    selectOneRttMs: { p50: pct(rtt, 50), p95: pct(rtt, 95) },
    setStatus: { n: N, queriesPerCall: queries / N, p50: pct(times, 50), p95: pct(times, 95) },
  }, null, 2));
  await sql`delete from sessions where id = ${session.id}`;
  await sql.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
