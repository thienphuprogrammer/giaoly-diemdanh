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

export async function handleHealth(deps: HealthDeps): Promise<Response> {
  const db = await dbIsUp(deps);
  return Response.json({ ok: db, db, version: deps.version }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
