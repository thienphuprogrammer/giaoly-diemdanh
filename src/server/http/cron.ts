import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Xác thực tác vụ định kỳ `/api/cron/nhac-viec` (spec §4). Chỉ bằng header `Authorization: Bearer <CRON_SECRET>` (cũng
 * chính là định dạng Vercel Cron gửi); không đọc phiên/cookie. So sánh hằng thời gian trên băm SHA-256 (hai bên luôn
 * cùng độ dài, không lộ độ dài bí mật qua thời gian). Bí mật chưa đặt hoặc ngắn hơn 32 ký tự => coi như chưa cấu hình:
 * route trả 503 và KHÔNG BAO GIỜ chạy (đóng khi lỗi cấu hình). Bí mật không bao giờ vào log hay thân phản hồi.
 */
export const CRON_SECRET_MIN_LENGTH = 32;

export type CronAuth = "ok" | "denied" | "unconfigured";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function authorizeCron(header: string | null | undefined, secret: string | undefined): CronAuth {
  if (typeof secret !== "string" || secret.trim().length < CRON_SECRET_MIN_LENGTH) return "unconfigured";
  if (typeof header !== "string") return "denied";
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`)) ? "ok" : "denied";
}

/** Chỉ số đếm (không id, không tên, không email). */
export interface CronSummary {
  sent: number;
  skipped: number;
  failed: number;
  pruned: number;
  /** false khi dừng vì hết ngân sách thời gian (phần còn lại để lần chạy sau). */
  complete: boolean;
}

export interface CronDeps {
  env: Readonly<Record<string, string | undefined>>;
  run: (now: Date) => Promise<CronSummary>;
  now?: () => Date;
  log?: (message: string) => void;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

export async function handleCronRequest(request: Request, deps: CronDeps): Promise<Response> {
  const auth = authorizeCron(request.headers.get("authorization"), deps.env.CRON_SECRET);
  if (auth === "unconfigured") return json(503, { error: "unavailable" });
  if (auth === "denied") return json(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
  const log = deps.log ?? ((m: string) => console.warn(m));
  try {
    const s = await deps.run((deps.now ?? (() => new Date()))());
    return json(200, { sent: s.sent, skipped: s.skipped, failed: s.failed, pruned: s.pruned, complete: s.complete });
  } catch (e) {
    // Không in thông điệp lỗi (lỗi driver có thể chứa chuỗi kết nối); chỉ tên lớp lỗi.
    log(`cron: nhac-viec failed (${e instanceof Error ? e.name : "unknown"})`);
    return json(500, { error: "failed" });
  }
}
