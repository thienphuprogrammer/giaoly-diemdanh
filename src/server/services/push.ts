import { and, eq, gte, sql } from "drizzle-orm";
import { pushSubscriptions } from "@/db/schema";
import type { Db } from "@/db/types";
import type { AppUser } from "@/lib/access/can-access";
import { INVALID_SUBSCRIPTION, parsePushSubscription, validatePushEndpoint } from "@/lib/push/endpoint";
import type { PushMessage } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/send";
import type { VapidConfig } from "@/lib/push/vapid";
import type { RateLimiter } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "../result";

/**
 * Đăng ký/huỷ/gửi Web Push (spec §4). Người dùng chỉ đăng ký/huỷ cho CHÍNH MÌNH (`user` lấy từ phiên, không từ client).
 * Endpoint là duy nhất: thiết bị đổi tài khoản thì dòng chuyển sang tài khoản mới (không ghi nhật ký thay đổi: đây là
 * cài đặt thiết bị, không phải dữ liệu lớp). Không bao giờ ghi log endpoint hay khoá.
 */
export const PUSH_MAX_PER_USER = 10;
export const PUSH_MAX_FAILURES = 5;
const UA_MAX = 200;
const RATE_LIMITED = "Thao tác quá nhanh, vui lòng thử lại sau ít phút";

const limited = (limiter: RateLimiter, user: AppUser) => !limiter.hit(user.id).allowed;

export async function subscribePush(
  db: Db, user: AppUser, input: unknown, deps: { limiter: RateLimiter; userAgent?: string | null },
): Promise<ActionResult> {
  if (limited(deps.limiter, user)) return fail(RATE_LIMITED);
  const parsed = parsePushSubscription(input);
  if (!parsed.ok) return fail(parsed.error);
  const { endpoint, keys } = parsed.value;
  const userAgent = deps.userAgent ? deps.userAgent.slice(0, UA_MAX) : null;
  await db.transaction(async (tx) => {
    await tx.insert(pushSubscriptions)
      .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent, createdAt: sql`now()`, failureCount: 0 },
      });
    // Giữ tối đa PUSH_MAX_PER_USER thiết bị mới nhất của người này.
    await tx.execute(sql`
      delete from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${user.id} and ${pushSubscriptions.id} not in (
        select ${pushSubscriptions.id} from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${user.id}
        order by ${pushSubscriptions.createdAt} desc, ${pushSubscriptions.id} desc limit ${PUSH_MAX_PER_USER})`);
  });
  return ok(undefined);
}

export async function unsubscribePush(db: Db, user: AppUser, input: unknown, deps: { limiter: RateLimiter }): Promise<ActionResult> {
  if (limited(deps.limiter, user)) return fail(RATE_LIMITED);
  const raw = typeof input === "object" && input !== null ? (input as { endpoint?: unknown }).endpoint : undefined;
  const endpoint = validatePushEndpoint(raw);
  if (!endpoint.ok) return fail(INVALID_SUBSCRIPTION);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint.endpoint), eq(pushSubscriptions.userId, user.id)));
  return ok(undefined);
}

export type PushSend = typeof sendPush;
export interface SendDeps { vapid: VapidConfig; send?: PushSend }
export interface SendSummary { sent: number; removed: number; failed: number }

type SubscriptionRow = typeof pushSubscriptions.$inferSelect;

/** Áp kết quả gửi lên một đăng ký; trả về đăng ký có bị xoá không. */
async function applyOutcome(db: Db, row: SubscriptionRow, outcome: string): Promise<boolean> {
  const byId = eq(pushSubscriptions.id, row.id);
  if (outcome === "ok") {
    await db.update(pushSubscriptions).set({ lastOkAt: sql`now()`, failureCount: 0 }).where(byId);
    return false;
  }
  if (outcome === "gone") {
    await db.delete(pushSubscriptions).where(byId);
    return true;
  }
  if (outcome !== "retry") return false;
  await db.update(pushSubscriptions).set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` }).where(byId);
  const removed = await db.delete(pushSubscriptions)
    .where(and(byId, gte(pushSubscriptions.failureCount, PUSH_MAX_FAILURES))).returning({ id: pushSubscriptions.id });
  return removed.length > 0;
}

/** Gửi tới mọi thiết bị của một người dùng và dọn đăng ký hết hạn/lỗi lặp lại. Dùng chung cho Task 39 (nhắc việc). */
export async function sendToUser(db: Db, userId: string, message: PushMessage, deps: SendDeps): Promise<SendSummary> {
  const send = deps.send ?? sendPush;
  const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const results = await Promise.all(rows.map(async (row) => {
    const { outcome } = await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message, { vapid: deps.vapid });
    return { outcome, removed: await applyOutcome(db, row, outcome) };
  }));
  return {
    sent: results.filter((r) => r.outcome === "ok").length,
    removed: results.filter((r) => r.removed).length,
    // Lỗi gửi (tạm thời hoặc khác); đăng ký hết hạn (404/410) chỉ tính vào `removed`.
    failed: results.filter((r) => r.outcome === "retry" || r.outcome === "error").length,
  };
}

export const TEST_MESSAGE: PushMessage = {
  title: "Điểm danh Giáo lý",
  body: "Thông báo thử: thiết bị này đã sẵn sàng nhận nhắc việc.",
  url: "/tai-khoan",
};

/** "Gửi thử" ở trang Tài khoản: chỉ tới thiết bị của chính người bấm. */
export async function sendTestPush(
  db: Db, user: AppUser, deps: { limiter: RateLimiter; vapid: VapidConfig | null; send?: PushSend },
): Promise<ActionResult<{ sent: number }>> {
  if (limited(deps.limiter, user)) return fail(RATE_LIMITED);
  if (!deps.vapid) return fail("Máy chủ chưa được cấu hình thông báo đẩy. Hãy báo người quản trị.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id));
  if (n === 0) return fail("Tài khoản này chưa có thiết bị nào bật thông báo.");
  const summary = await sendToUser(db, user.id, TEST_MESSAGE, { vapid: deps.vapid, send: deps.send });
  if (summary.sent === 0) return fail("Không gửi được thông báo thử. Hãy tắt rồi bật lại thông báo trên thiết bị này.");
  return ok({ sent: summary.sent });
}
