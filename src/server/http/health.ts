/**
 * Health check công khai (không xác thực): chỉ trả cờ chung và phiên bản, không bao giờ chi tiết lỗi/cấu hình.
 * Thuần: kiểm DB được tiêm vào để test mà không cần database.
 */
export const HEALTH_DB_TIMEOUT_MS = 2000;

export function versionFromEnv(env: Record<string, string | undefined>): string {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
}

export interface HealthDeps {
  /** Chạy `select 1`; ném lỗi khi DB không dùng được. */
  checkDb: () => Promise<unknown>;
  version: string;
  timeoutMs?: number;
}

async function dbIsUp({ checkDb, timeoutMs = HEALTH_DB_TIMEOUT_MS }: HealthDeps): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    });
    await Promise.race([checkDb(), timeout]);
    return true;
  } catch {
    return false; // cố ý nuốt: không để lộ lỗi ra ngoài
  } finally {
    clearTimeout(timer);
  }
}

function respond(db: boolean, version: string): Response {
  return Response.json({ ok: db, db, version }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export async function handleHealth(deps: HealthDeps): Promise<Response> {
  return respond(await dbIsUp(deps), deps.version);
}

export interface CachedHealthDeps extends HealthDeps {
  /** Thời gian nhớ kết quả (ms). Mặc định 5 giây. */
  ttlMs?: number;
  now?: () => number;
}

export const HEALTH_CACHE_TTL_MS = 5000;

/**
 * Bộ xử lý nhớ kết quả kiểm tra DB trong vài giây (mỗi instance): request dồn dập (giám sát, kẻ xấu) không tạo tải lên DB.
 * Nhớ cả kết quả lỗi và cả lần kiểm tra đang chạy dở (các request đồng thời dùng chung một lần).
 */
export function createHealthHandler(deps: CachedHealthDeps): () => Promise<Response> {
  const { ttlMs = HEALTH_CACHE_TTL_MS, now = Date.now } = deps;
  let memo: { at: number; result: Promise<boolean> } | undefined;
  return async () => {
    if (!memo || now() - memo.at > ttlMs) memo = { at: now(), result: dbIsUp(deps) };
    return respond(await memo.result, deps.version);
  };
}
