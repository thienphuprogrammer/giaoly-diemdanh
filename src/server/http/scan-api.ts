import { unstable_rethrow } from "next/navigation";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import type { RateLimiter } from "@/lib/rate-limit";
import { applyScan, applyUndo, getScanRoster, type ScanErrorCode } from "../services/scan";

export type ScanRoute = "scan" | "undo" | "roster";
export interface ScanApiDeps { db: Db; getUser: () => Promise<AppUser | null>; limiter: RateLimiter; rosterLimiter: RateLimiter }

const MAX_BODY = 4096;
const HEADERS = { "Cache-Control": "private, no-store" };
const STATUS: Record<ScanErrorCode, number> = {
  bad_request: 400, forbidden: 404, invalid_card: 200, cancelled: 200, conflict: 200,
  event_conflict: 409, rate_limited: 429, unauthenticated: 401,
};

export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  // Sau nhiều proxy, X-Forwarded-Host có thể là danh sách; mục đầu là host gốc của trình duyệt.
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, "Content-Type": "application/json", ...extra } });
const error = (code: ScanErrorCode, message: string, extra?: Record<string, string>) =>
  respond({ ok: false, code, error: message }, STATUS[code], extra);

/** Từ chối yêu cầu khác nguồn (CSRF): 403, khác với 404 dùng để giấu buổi học không có quyền. */
const crossSite = () => respond({ ok: false, code: "forbidden", error: "Yêu cầu không hợp lệ" }, 403);

/** Kiểu nội dung không kèm tham số, viết thường: "Application/JSON; charset=utf-8" -> "application/json". */
const mediaType = (value: string | null) => (value ?? "").split(";")[0].trim().toLowerCase();

function rateLimited(limiter: RateLimiter, userId: string): Response | null {
  const limit = limiter.hit(userId);
  if (limit.allowed) return null;
  return error("rate_limited", "Quá nhiều lượt, thử lại sau giây lát", { "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) });
}

const tooLarge = () => respond({ ok: false, code: "bad_request", error: "Yêu cầu quá lớn" }, 413);

/** Đọc thân yêu cầu nhưng dừng ngay khi vượt MAX_BODY byte, không đệm cả thân lớn vào bộ nhớ. */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function readBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  if (mediaType(request.headers.get("content-type")) !== "application/json") return { ok: false, response: respond({ ok: false, code: "bad_request", error: "Kiểu dữ liệu không hợp lệ" }, 415) };
  const text = await readCapped(request);
  if (text === null) return { ok: false, response: tooLarge() };
  try { return { ok: true, body: JSON.parse(text) }; } catch { return { ok: false, response: error("bad_request", "Yêu cầu không hợp lệ") }; }
}

/**
 * Lỗi bất ngờ (thường từ DB) có thể mang tham số truy vấn — tức là mã thẻ — trong message.
 * Không ghi message/stack, chỉ ghi tên lỗi và mã SQLSTATE; trả 500 trơn.
 */
export async function handleScanApi(route: ScanRoute, request: Request, deps: ScanApiDeps): Promise<Response> {
  try {
    return await dispatch(route, request, deps);
  } catch (e) {
    unstable_rethrow(e); // notFound()/redirect()… từ Next phải đi tiếp, không thành 500
    const err = e as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
    console.error("scan api failure", { route, name: String(err?.name ?? "unknown"), code: String(err?.code ?? err?.cause?.code ?? "") });
    return respond({ ok: false, error: "Có lỗi xảy ra, hãy thử lại" }, 500);
  }
}

async function dispatch(route: ScanRoute, request: Request, deps: ScanApiDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return error("unauthenticated", "Bạn cần đăng nhập");

  if (route === "roster") {
    if (request.headers.get("sec-fetch-site") === "cross-site") return crossSite();
    const limited = rateLimited(deps.rosterLimiter, user.id);
    if (limited) return limited;
    const sessionId = new URL(request.url).searchParams.get("sessionId") ?? "";
    const roster = await getScanRoster(deps.db, user, sessionId);
    return roster ? respond({ ok: true, data: roster }) : error("forbidden", "Không tìm thấy buổi học");
  }

  if (!isSameOrigin(request.headers)) return crossSite();
  const limited = rateLimited(deps.limiter, user.id);
  if (limited) return limited;
  const body = await readBody(request);
  if (!body.ok) return body.response;

  const result = route === "scan" ? await applyScan(deps.db, user, body.body) : await applyUndo(deps.db, user, body.body);
  return result.ok ? respond(result) : respond(result, STATUS[result.code]);
}
