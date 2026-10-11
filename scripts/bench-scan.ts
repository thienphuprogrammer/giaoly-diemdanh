import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { encryptSession } from "../src/lib/auth/session";

/**
 * Đo đường quét qua HTTP thật (POST /api/diem-danh/quet) trên server đang chạy.
 * Cần server dùng CÙNG DATABASE_URL (= E2E_DATABASE_URL) và AUTH_SECRET với script; DB đã seed bằng e2e/global-setup.ts.
 */
const base = process.env.BENCH_BASE_URL ?? "http://localhost:3100";
const dbUrl = process.env.E2E_DATABASE_URL;
const secret = process.env.AUTH_SECRET;
if (!dbUrl || !secret) throw new Error("Cần E2E_DATABASE_URL và AUTH_SECRET (đúng giá trị của server đang chạy)");
if (!/e2e/i.test(new URL(dbUrl).pathname)) throw new Error("Tên database phải chứa 'e2e'");

const HELD_ON = "2000-01-02"; // không thể trùng dữ liệu thật
const OWNER_NOTE = "bench-scan";
const WARMUP = 3;
const SEED_MISSING = "Chưa có dữ liệu seed E2E (chạy e2e/global-setup trước)";
// Nearest-rank, giống scripts/bench-baseline.ts.
const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))] * 10) / 10;
};

async function main() {
  const sql = postgres(dbUrl!, { max: 1 });
  let sessionId: string | null = null;
  try {
    const [user] = await sql`select id from users where email = 'glv-a@e2e.vn'`;
    const [cls] = await sql`select id from classes where name = 'Lớp Q'`;
    const [term] = await sql`select id from terms limit 1`;
    if (!user || !cls || !term) throw new Error(SEED_MISSING);

    // Chỉ dùng/xóa phiên do chính script này tạo (ghi dấu bằng note).
    const [existing] = await sql`select id, note from sessions where class_id = ${cls.id} and held_on = ${HELD_ON}`;
    if (existing && existing.note !== OWNER_NOTE) throw new Error(`Đã có buổi ${HELD_ON} không do script tạo; dừng để không xóa nhầm`);
    sessionId = existing?.id ?? (await sql`insert into sessions (class_id, term_id, held_on, note) values (${cls.id}, ${term.id}, ${HELD_ON}, ${OWNER_NOTE}) returning id`)[0].id;

    const tokens = (await sql`select qr_token from students where class_id = ${cls.id} and active order by full_name`).map((r) => r.qr_token as string);
    if (tokens.length === 0) throw new Error(SEED_MISSING);
    const cookie = `session=${await encryptSession({ userId: user.id }, secret!)}`;
    const headers = { "Content-Type": "application/json", Origin: base, Cookie: cookie };
    const post = async (token: string) => {
      const t = performance.now();
      const res = await fetch(`${base}/api/diem-danh/quet`, { method: "POST", headers, body: JSON.stringify({ eventId: crypto.randomUUID(), sessionId, kind: "scan", token, mode: "present" }) });
      const body = (await res.json()) as { ok?: boolean; data?: { result?: string } };
      const ms = performance.now() - t;
      if (res.status !== 200 || !body.ok || body.data?.result !== "applied") throw new Error(`Lượt quét không được ghi: HTTP ${res.status} ${JSON.stringify(body)}`);
      return ms;
    };
    const reset = () => sql`delete from attendance where session_id = ${sessionId}`;

    await reset();
    for (const t of tokens.slice(0, WARMUP)) await post(t); // khởi động kết nối/JIT, không tính
    await reset();
    const sequential: number[] = [];
    for (const t of tokens) sequential.push(await post(t));

    await reset();
    const queue = [...tokens];
    const parallel: number[] = [];
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 5 }, async () => { for (let t = queue.shift(); t; t = queue.shift()) parallel.push(await post(t)); }));
    const wall = Math.round(performance.now() - t0);

    console.log(JSON.stringify({
      base, scans: tokens.length,
      sequentialMs: { p50: pct(sequential, 50), p95: pct(sequential, 95), max: pct(sequential, 100) },
      parallel5Ms: { p50: pct(parallel, 50), p95: pct(parallel, 95), max: pct(parallel, 100), wallMs: wall },
    }, null, 2));
  } finally {
    if (sessionId) await sql`delete from sessions where id = ${sessionId} and note = ${OWNER_NOTE}`;
    await sql.end();
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
