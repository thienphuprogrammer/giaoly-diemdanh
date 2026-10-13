import { performance } from "node:perf_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { errorSummary } from "../src/lib/error-summary";
import * as s from "../src/db/schema";
import type { Db } from "../src/db/types";
import { setStatus } from "../src/server/services/attendance";

/** Lỗi do chính script đặt ra: thông điệp an toàn để in nguyên văn (không chứa cấu hình). */
class BenchStop extends Error {}
/** Dừng ngay với thông điệp an toàn (không in URL/chuỗi kết nối, kể cả khi URL sai định dạng). */
const stop = (message: string): never => { console.error(message); process.exit(1); };
const isE2eDb = (raw: string) => { try { return /e2e/i.test(new URL(raw).pathname); } catch { return false; } };

const url = process.env.E2E_DATABASE_URL;
if (!url) stop("Thiếu E2E_DATABASE_URL");
if (!isE2eDb(url!)) stop("E2E_DATABASE_URL không hợp lệ hoặc tên database không chứa 'e2e'");

const N = 200;
const HELD_ON = "2000-01-01"; // không thể trùng dữ liệu thật
const OWNER_NOTE = "bench-baseline";
const SEED_MISSING = "Chưa có dữ liệu seed E2E (chạy e2e/global-setup trước)";
// Nearest-rank: chỉ số = ceil(p/100 * n) - 1, kẹp trong [0, n-1].
const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
};

async function main() {
  let queries = 0;
  const sql = postgres(url!, { max: 5 });
  let createdSessionId: string | null = null;
  try {
    const db = drizzle(sql, { schema: s, logger: { logQuery: () => { queries++; } } }) as unknown as Db;

    const [user] = await sql`select id, email, name, grade_id, is_grade_head from users where email = 'glv-a@e2e.vn'`;
    if (!user) throw new BenchStop(SEED_MISSING);
    const [cls] = await sql`select c.id from classes c join class_catechists cc on cc.class_id = c.id where cc.user_id = ${user.id} limit 1`;
    if (!cls) throw new BenchStop(SEED_MISSING);
    const kids = await sql`select id from students where class_id = ${cls.id} and active limit 4`;
    if (kids.length < 1) throw new BenchStop(SEED_MISSING);
    const [term] = await sql`select id from terms limit 1`;
    if (!term) throw new BenchStop(SEED_MISSING);

    // Chỉ dùng/xóa phiên do chính script này tạo (ghi dấu bằng note).
    const [existing] = await sql`select id, note from sessions where class_id = ${cls.id} and held_on = ${HELD_ON} and kind = 'class'`;
    if (existing && existing.note !== OWNER_NOTE) {
      throw new BenchStop(`Đã có phiên ${HELD_ON} của lớp này không do bench tạo (note khác '${OWNER_NOTE}'); dừng để không xóa dữ liệu thật`);
    }
    // Nếu còn sót phiên của lần chạy trước bị ngắt (note đúng dấu) thì xóa rồi tạo lại.
    if (existing) await sql`delete from sessions where id = ${existing.id} and note = ${OWNER_NOTE}`;
    const [session] = await sql`insert into sessions (class_id, term_id, held_on, note) values (${cls.id}, ${term.id}, ${HELD_ON}, ${OWNER_NOTE}) returning id`;
    createdSessionId = session.id;
    const appUser = { id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin === true, sessionVersion: Number(user.session_version ?? 0), isGradeHead: user.is_grade_head, gradeId: user.grade_id };

    const rtt: number[] = [];
    for (let i = 0; i < 50; i++) { const t = performance.now(); await sql`select 1`; rtt.push(performance.now() - t); }

    const times: number[] = [];
    queries = 0;
    for (let i = 0; i < N; i++) {
      const t = performance.now();
      const r = await setStatus(db, appUser, { sessionId: session.id, studentId: kids[i % kids.length].id, status: i % 2 ? "present" : "absent_unexcused", reason: null });
      if (!r.ok) throw new BenchStop(`setStatus thất bại: ${JSON.stringify(r)}`);
      times.push(performance.now() - t);
    }
    console.log(JSON.stringify({
      selectOneRttMs: { p50: pct(rtt, 50), p95: pct(rtt, 95) },
      setStatus: { n: N, queriesPerCall: queries / N, p50: pct(times, 50), p95: pct(times, 95) },
    }, null, 2));
  } finally {
    if (createdSessionId) await sql`delete from sessions where id = ${createdSessionId} and note = ${OWNER_NOTE}`;
    await sql.end();
  }
}
main().catch((e: unknown) => { console.error(e instanceof BenchStop ? e.message : errorSummary(e)); process.exit(1); });
