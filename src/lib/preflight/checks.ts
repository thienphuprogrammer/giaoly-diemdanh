import { parsePoolMax, strippedUrlParams } from "../../db/connection-options";
import { checkVapid } from "../push/vapid";

/** Kiểm tra trước triển khai (thuần, test được). Thông điệp tiếng Việt; không bao giờ chứa bí mật hay chuỗi kết nối đầy đủ. */
export type CheckLevel = "ok" | "warn" | "fail" | "info";
export interface Check { id: string; level: CheckLevel; message: string }
export interface EnvOptions { prod: boolean }
type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const PLACEHOLDER = /change.?me|secret|password|example|your[-_ ]|default/i;
const MIN_SECRET = 32;

const keep = (s: string, n: number) => (s.length <= n ? s.slice(0, 1) : s.slice(0, n)) + "***";

/** postgres://us***@ep***.neon.tech:5432/db — che user, che phần đầu host, bỏ hẳn mật khẩu và query. */
export function maskDatabaseUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const labels = u.hostname.split(".");
    const host = labels.length > 2 ? `${keep(labels[0], 2)}.${labels.slice(-2).join(".")}` : keep(u.hostname, 2);
    const user = u.username ? `${keep(decodeURIComponent(u.username), 2)}@` : "";
    return `${u.protocol}//${user}${host}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(không đọc được chuỗi kết nối)";
  }
}

function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "postgres:" || u.protocol === "postgresql:" ? u : null;
  } catch {
    return null;
  }
}

function checkDatabaseUrl(env: Env, { prod }: EnvOptions): Check[] {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return [{ id: "DATABASE_URL", level: "fail", message: "Thiếu DATABASE_URL (chuỗi kết nối Postgres)." }];
  const url = parseUrl(raw);
  if (!url) return [{ id: "DATABASE_URL", level: "fail", message: "DATABASE_URL không đọc được: phải có dạng postgres://người-dùng:mật-khẩu@máy-chủ:cổng/tên-db." }];

  const checks: Check[] = [];
  const local = LOCAL_HOSTS.has(url.hostname) || url.hostname.startsWith("127.");
  if (local && prod) {
    checks.push({ id: "DATABASE_URL", level: "fail", message: `DATABASE_URL trỏ về máy cục bộ (${maskDatabaseUrl(raw)}) nhưng đang kiểm cho production. Dùng chuỗi kết nối của Postgres trên mạng.` });
  } else {
    checks.push({ id: "DATABASE_URL", level: "ok", message: `DATABASE_URL hợp lệ: ${maskDatabaseUrl(raw)}` });
  }

  const sslmode = url.searchParams.get("sslmode");
  if (!local && prod && !(sslmode && sslmode !== "disable")) {
    checks.push({ id: "DATABASE_SSL", level: "warn", message: "DATABASE_URL chưa có ?sslmode=require. Postgres trên mạng (Neon/Supabase) cần SSL; hãy thêm ?sslmode=require vào cuối chuỗi." });
  }

  const stripped = strippedUrlParams(raw);
  if (stripped.length > 0) {
    checks.push({ id: "DATABASE_PARAMS", level: "warn", message: `DATABASE_URL có tham số sẽ bị bỏ khi kết nối (${stripped.join(", ")}). App chỉ giữ sslmode vì các tham số khác làm kết nối thất bại; nên xóa chúng khỏi chuỗi cho gọn.` });
  }

  // Chỉ Supabase pooler giao dịch bắt buộc; Neon pooled (-pooler) hỗ trợ câu lệnh đã chuẩn bị nên không cảnh báo.
  const supabasePooler = url.port === "6543" || /pooler\.supabase\.com$/i.test(url.hostname);
  if (supabasePooler && env.DB_PREPARE !== "false" && env.DB_PREPARE !== "0") {
    checks.push({ id: "DB_PREPARE", level: "warn", message: "Có vẻ đang dùng pooler giao dịch của Supabase (cổng 6543 hoặc pooler.supabase.com). Hãy đặt DB_PREPARE=false, nếu không có thể gặp lỗi 'prepared statement does not exist'." });
  }
  return checks;
}

function checkAuthSecret(env: Env): Check {
  const s = env.AUTH_SECRET ?? "";
  const fail = (message: string): Check => ({ id: "AUTH_SECRET", level: "fail", message });
  if (!s) return fail("Thiếu AUTH_SECRET. Sinh bằng: openssl rand -base64 48");
  if (s.length < MIN_SECRET) return fail(`AUTH_SECRET quá ngắn (${s.length} ký tự, cần tối thiểu ${MIN_SECRET}). Sinh bằng: openssl rand -base64 48`);
  if (new Set(s).size < 8 || PLACEHOLDER.test(s)) return fail("AUTH_SECRET trông như giá trị mẫu hoặc lặp ký tự. Sinh khóa ngẫu nhiên bằng: openssl rand -base64 48");
  return { id: "AUTH_SECRET", level: "ok", message: `AUTH_SECRET đạt (${s.length} ký tự).` };
}

/** Thông báo đẩy là tuỳ chọn: chưa đặt = thông tin; đặt thiếu/sai = cảnh báo (chỉ nêu tên biến); đủ và đúng = thông tin. */
function pushCheck(env: Env): Check {
  const vapid = checkVapid(env);
  if (vapid.status === "unset") return { id: "OPTIONAL_PUSH", level: "info", message: "VAPID_*: chưa đặt (thông báo đẩy tắt). Sinh khoá bằng: pnpm push:keys" };
  if (vapid.status === "invalid") return { id: "OPTIONAL_PUSH", level: "warn", message: `VAPID_*: thông báo đẩy sẽ không hoạt động. ${vapid.problems.join(" ")}` };
  return { id: "OPTIONAL_PUSH", level: "info", message: "VAPID_*: đã đặt và hợp lệ (thông báo đẩy bật)." };
}

const CRON_DOC = "Xem docs/deploy-vercel-ios.md, mục \"Nhắc việc tự động\"; sinh bằng: openssl rand -base64 48";

/**
 * Nhắc việc tự động cần CRON_SECRET (≥ 32 ký tự); thiếu/ngắn thì route cron trả 503: cảnh báo (production) hoặc ghi chú
 * (dev), không làm fail.
 */
function cronCheck(env: Env, { prod }: EnvOptions): Check {
  const raw = env.CRON_SECRET ?? "";
  const s = raw.trim();
  const warn = (message: string): Check => ({ id: "OPTIONAL_CRON", level: "warn", message: `${message} ${CRON_DOC}.` });
  if (!s) {
    const message = `CRON_SECRET: chưa đặt, nhắc việc tự động (/api/cron/nhac-viec) sẽ không chạy. ${CRON_DOC}.`;
    return { id: "OPTIONAL_CRON", level: prod ? "warn" : "info", message };
  }
  if (s !== raw) return warn("CRON_SECRET có khoảng trắng hoặc xuống dòng ở đầu/cuối (thường do dán nhầm). App tự cắt, nhưng nơi gọi (GitHub/cron-job.org) có thể gửi giá trị khác: hãy xoá khoảng trắng ở mọi nơi.");
  if (s.length < MIN_SECRET) return warn(`CRON_SECRET quá ngắn (${s.length} ký tự, cần tối thiểu ${MIN_SECRET}); route nhắc việc sẽ từ chối chạy.`);
  if (new Set(s).size < 8 || PLACEHOLDER.test(s)) return warn("CRON_SECRET trông như giá trị mẫu hoặc lặp ký tự.");
  return { id: "OPTIONAL_CRON", level: "info", message: `CRON_SECRET: đã đặt (${s.length} ký tự).` };
}

export function checkEnv(env: Env, opts: EnvOptions): Check[] {
  const checks: Check[] = [...checkDatabaseUrl(env, opts), checkAuthSecret(env)];

  if (env.NEXT_PUBLIC_E2E_SCAN_BRIDGE) {
    checks.push({ id: "E2E_BRIDGE", level: opts.prod ? "fail" : "warn", message: "NEXT_PUBLIC_E2E_SCAN_BRIDGE đang được đặt. Biến này chỉ dành cho E2E; không đặt trên Vercel/production." });
  }
  if (env.CSP_ALLOW_UNSAFE_EVAL === "1") {
    checks.push({ id: "CSP_UNSAFE_EVAL", level: "warn", message: "CSP_ALLOW_UNSAFE_EVAL=1 làm yếu chính sách bảo mật (cho phép 'unsafe-eval') để máy quét chạy trên iPhone iOS 15 trở xuống. Chỉ bật nếu thật sự có máy iOS 15; mặc định nên tắt." });
  }
  if (env.DB_POOL_MAX !== undefined && env.DB_POOL_MAX !== "" && parsePoolMax(env.DB_POOL_MAX) === null) {
    checks.push({ id: "DB_POOL_MAX", level: "warn", message: "DB_POOL_MAX không hợp lệ (cần số nguyên 1–20); đang dùng mặc định 5." });
  }

  // Thông báo đẩy và nhắc việc: chỉ báo trạng thái, không bao giờ in giá trị.
  checks.push(pushCheck(env));
  checks.push(cronCheck(env, opts));
  if (env.PUSH_DRY_RUN) {
    checks.push(opts.prod
      ? { id: "PUSH_DRY_RUN", level: "fail", message: "PUSH_DRY_RUN đang được đặt. Biến này chỉ dành cho E2E (production luôn bỏ qua nó); hãy xoá khỏi biến môi trường của Vercel." }
      : { id: "PUSH_DRY_RUN", level: "info", message: "PUSH_DRY_RUN đang được đặt: ở dev/test thông báo đẩy không được gửi ra mạng." });
  }
  return checks;
}

/** So số migration trong mã (journal) với số đã áp dụng trong DB (`drizzle.__drizzle_migrations`). */
export function migrationStatus(inJournal: number, applied: number): Check {
  if (applied === inJournal) return { id: "MIGRATIONS", level: "ok", message: `Migration đã đủ (${applied}/${inJournal}).` };
  if (applied < inJournal) return { id: "MIGRATIONS", level: "fail", message: `Database mới áp dụng ${applied}/${inJournal} migration. Chạy: pnpm db:migrate` };
  return { id: "MIGRATIONS", level: "warn", message: `Database có ${applied} migration, nhiều hơn mã hiện tại (${inJournal}). Có thể đang chạy bản mã cũ hơn database.` };
}

/** TimeZone của phiên DB. Nhật ký/quét đã đọc đúng ở mọi múi giờ, nhưng cột `timestamp` không múi giờ nên UTC vẫn là cấu hình nên dùng. */
export function timezoneCheck(tz: string | null | undefined): Check {
  const name = (tz ?? "").trim();
  if (/^(utc|etc\/utc|gmt|etc\/gmt|z)$/i.test(name)) return { id: "DB_TIMEZONE", level: "ok", message: `Múi giờ DB là ${name}.` };
  return { id: "DB_TIMEZONE", level: "warn", message: `Múi giờ DB là "${name || "không rõ"}" (không phải UTC). Ứng dụng vẫn đọc đúng, nhưng nên đặt UTC cho các cột timestamp không múi giờ.` };
}

export interface Summary { ok: number; warn: number; fail: number; info: number; failed: boolean }

export function summarize(checks: readonly Check[]): Summary {
  const count = (l: CheckLevel) => checks.filter((c) => c.level === l).length;
  return { ok: count("ok"), warn: count("warn"), fail: count("fail"), info: count("info"), failed: count("fail") > 0 };
}
