/**
 * Tùy chọn kết nối postgres-js cho môi trường serverless/hosted (Neon, Supabase). Thuần để test được; không import gì của Next.
 * SSL: postgres-js tự đọc `?sslmode=require` trong DATABASE_URL, không cần cấu hình thêm ở đây.
 */
export interface PostgresOptions {
  max: number;
  prepare: boolean;
  idle_timeout: number;
  connect_timeout: number;
}

export const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 20;

/** `DB_POOL_MAX`: số nguyên 1..20; trả null khi thiếu hoặc không hợp lệ. */
export function parsePoolMax(raw: string | undefined): number | null {
  const s = raw?.trim() ?? "";
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_POOL_MAX ? n : null;
}

/** `DB_PREPARE=false` (hoặc `0`) bắt buộc khi dùng pooler chế độ giao dịch (pgbouncer cổng 6543), vì câu lệnh đã chuẩn bị gắn với phiên. */
export function postgresOptionsFromEnv(env: Record<string, string | undefined>): PostgresOptions {
  const prepareOff = env.DB_PREPARE === "false" || env.DB_PREPARE === "0";
  return {
    max: parsePoolMax(env.DB_POOL_MAX) ?? DEFAULT_POOL_MAX,
    prepare: !prepareOff,
    idle_timeout: 20, // giây: trả kết nối nhàn rỗi sớm để không giữ chỗ trên DB gói miễn phí
    connect_timeout: 10, // giây: lỗi nhanh thay vì treo hàm serverless
  };
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * postgres-js chuyển MỌI tham số lạ trên URL thành tham số khởi động của Postgres (ví dụ Neon `channel_binding=require`,
 * Supabase `pgbouncer=true`) và kết nối thất bại. Chỉ giữ `sslmode` (postgres-js tự hiểu). Chuỗi không đọc được trả nguyên.
 */
export function sanitizeDatabaseUrl(raw: string): string {
  const u = parseUrl(raw);
  if (!u) return raw;
  const sslmode = u.searchParams.get("sslmode");
  u.search = "";
  if (sslmode !== null) u.searchParams.set("sslmode", sslmode);
  return u.toString();
}

/** Tên (không có giá trị) các tham số URL mà `sanitizeDatabaseUrl` sẽ bỏ. */
export function strippedUrlParams(raw: string): string[] {
  const u = parseUrl(raw);
  if (!u) return [];
  return [...new Set([...u.searchParams.keys()].filter((k) => k !== "sslmode"))];
}

/** Chuỗi kết nối cho migration/seed: ưu tiên kết nối trực tiếp `DATABASE_URL_UNPOOLED` (chuỗi rỗng coi như không đặt). */
export function databaseUrlFromEnv(env: Record<string, string | undefined>): string {
  return env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || "";
}
