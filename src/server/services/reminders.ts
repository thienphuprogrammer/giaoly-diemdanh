import {
  catechistsOf, claimNotifications, classesOfGrades, currentTerm, gradeHeads, pruneNotificationLog, releaseNotification,
  scheduledClasses, thresholdHits, type Recipient, type ThresholdHit,
} from "@/db/queries/reminders";
import type { Db } from "@/db/types";
import type { PushMessage } from "@/lib/push/payload";
import type { PushSender } from "@/lib/push/send-many";
import { checkVapid } from "@/lib/push/vapid";
import {
  classReminderKey, classReminderMessage, thresholdKey, thresholdMessage, type ReminderKind, type ThresholdKind,
} from "@/lib/reminders/messages";
import { isClassReminderDue, vnClock, type VnClock } from "@/lib/reminders/schedule";
import type { CronSummary } from "../http/cron";
import { pruneAudit } from "../audit-retention";
import { sendToUser } from "./push";

/**
 * Tác vụ nhắc việc (spec §4), gọi từ `/api/cron/nhac-viec` mỗi ~10 phút:
 * 1. nhắc GLV được phân công khi 30 phút–3 giờ sau giờ học mà buổi HỌC hôm nay chưa có dấu điểm danh nào (bỏ buổi huỷ);
 *    một lần mỗi (lớp, ngày) mỗi GLV;
 * 2. báo trưởng khối khi em đang học ở lớp chạm ngưỡng vắng học hoặc vắng lễ trong học kỳ hiện tại; một lần mỗi
 *    (em, học kỳ, loại) mỗi trưởng khối, GỘP thành một thông báo mỗi trưởng khối mỗi loại mỗi lần chạy;
 * 3. dọn dẹp mỗi ngày một lần: nhật ký thay đổi > 365 ngày, `notification_log` cũ.
 *
 * Idempotent bằng "nhận trước khi gửi": dòng `notification_log` được chèn TRƯỚC khi gửi và chỉ gửi khi chèn được. Gửi
 * thất bại (mọi thiết bị lỗi) vẫn GIỮ dòng: không gửi lại ở lần sau (tránh bão gửi lại; thông báo ngưỡng vẫn hiện ở
 * "Cần chú ý"). Người nhận không có thiết bị nào (hoặc server chưa cấu hình VAPID) thì bỏ qua và KHÔNG ghi dòng, để bật
 * thông báo sau vẫn nhận được. Có ngân sách thời gian: hết thì dừng gọn trước khi bắt đầu đơn vị việc kế tiếp.
 */
export const REMINDER_BUDGET_MS = 25_000;
export const AUDIT_PRUNE_DAYS = 365;

export type Deliver = (userId: string, message: PushMessage) => Promise<{ sent: number; failed: number; removed: number }>;

export interface ReminderOptions {
  now: Date;
  /** null = thông báo đẩy chưa cấu hình: chỉ dọn dẹp. */
  deliver: Deliver | null;
  /** Đồng hồ cho ngân sách thời gian (ms); mặc định `Date.now`. */
  clock?: () => number;
  budgetMs?: number;
  /** Dọn dẹp hằng ngày; trả số dòng đã xoá. Mặc định nhật ký thay đổi + nhật ký thông báo. */
  prune?: (db: Db, now: Date) => Promise<number>;
  log?: (message: string) => void;
}

interface Tally { sent: number; skipped: number; failed: number }
const ZERO: Tally = { sent: 0, skipped: 0, failed: 0 };
const SKIPPED: Tally = { sent: 0, skipped: 1, failed: 0 };
const add = (a: Tally, b: Tally): Tally => ({ sent: a.sent + b.sent, skipped: a.skipped + b.skipped, failed: a.failed + b.failed });

interface Ctx {
  db: Db;
  now: Date;
  clock: VnClock;
  deliver: Deliver | null;
  outOfTime: () => boolean;
  log: (message: string) => void;
}
interface Step extends Tally { stopped: boolean }

async function deliverSafely(ctx: Ctx, deliver: Deliver, userId: string, message: PushMessage): Promise<Tally> {
  try {
    const r = await deliver(userId, message);
    return r.sent > 0 ? { sent: 1, skipped: 0, failed: 0 } : { sent: 0, skipped: 0, failed: 1 };
  } catch {
    ctx.log("reminders: deliver failed"); // không in lỗi (có thể chứa endpoint)
    return { sent: 0, skipped: 0, failed: 1 };
  }
}

/** Nhận các khoá cho một người nhận rồi gửi một thông báo dựng từ các khoá vừa nhận được. */
async function notify(ctx: Ctx, kind: ReminderKind, recipient: Recipient, keys: readonly string[], build: (fresh: Set<string>) => PushMessage): Promise<Tally> {
  if (!ctx.deliver || !recipient.hasDevice) return SKIPPED;
  const fresh = await claimNotifications(ctx.db, kind, keys, recipient.userId);
  if (fresh.size === 0) return SKIPPED;
  return deliverSafely(ctx, ctx.deliver, recipient.userId, build(fresh));
}

async function classReminders(ctx: Ctx): Promise<Step> {
  const { date } = ctx.clock;
  const due = (await scheduledClasses(ctx.db, ctx.clock.weekday, date))
    .filter((c) => isClassReminderDue(c, ctx.clock) && !c.cancelled && !c.marked);
  const recipients = await catechistsOf(ctx.db, due.map((c) => c.id));
  let tally = ZERO;
  for (const cls of due) {
    if (ctx.outOfTime()) return { ...tally, stopped: true };
    const key = classReminderKey(cls.id, date);
    for (const r of recipients.filter((x) => x.classId === cls.id)) {
      tally = add(tally, await notify(ctx, "class_reminder", r, [key], () => classReminderMessage(cls, date)));
    }
  }
  return { ...tally, stopped: false };
}

const THRESHOLD_KINDS: readonly ThresholdKind[] = ["absence_threshold", "mass_threshold"];

async function thresholdNotices(ctx: Ctx): Promise<Step> {
  const heads = await gradeHeads(ctx.db);
  const term = heads.length > 0 ? await currentTerm(ctx.db, ctx.clock.date) : null;
  if (!term) return { ...ZERO, stopped: false };
  const classList = await classesOfGrades(ctx.db, [...new Set(heads.map((h) => h.gradeId))]);
  const gradeOf = new Map(classList.map((c) => [c.id, c.gradeId]));
  const nameOf = new Map(classList.map((c) => [c.id, c.name]));
  const hits = await thresholdHits(ctx.db, classList.map((c) => c.id), term, ctx.clock.date);
  let tally = ZERO;
  for (const kind of THRESHOLD_KINDS) {
    for (const head of heads) {
      if (ctx.outOfTime()) return { ...tally, stopped: true };
      const mine = hits.filter((h) => h.kind === kind && gradeOf.get(h.classId) === head.gradeId);
      if (mine.length === 0) continue;
      const keyOf = (h: ThresholdHit) => thresholdKey(h.studentId, term.id);
      tally = add(tally, await notify(ctx, kind, head, mine.map(keyOf), (fresh) =>
        thresholdMessage(kind, mine.filter((h) => fresh.has(keyOf(h))).map((h) => nameOf.get(h.classId) ?? ""))));
    }
  }
  return { ...tally, stopped: false };
}

async function defaultPrune(db: Db, now: Date): Promise<number> {
  const audit = await pruneAudit(db, { olderThanDays: AUDIT_PRUNE_DAYS, now });
  return audit.deleted + (await pruneNotificationLog(db, now));
}

/** Mỗi ngày (giờ Việt Nam) một lần, nhận bằng dòng `housekeeping` (không người nhận). Lỗi thì nhả để lần sau thử lại. */
async function housekeeping(ctx: Ctx, prune: (db: Db, now: Date) => Promise<number>): Promise<number> {
  const day = ctx.clock.date;
  if ((await claimNotifications(ctx.db, "housekeeping", [day], null)).size === 0) return 0;
  try {
    return await prune(ctx.db, ctx.now);
  } catch {
    ctx.log("reminders: housekeeping failed");
    await releaseNotification(ctx.db, "housekeeping", day, null);
    return 0;
  }
}

export async function runReminders(db: Db, opts: ReminderOptions): Promise<CronSummary> {
  const timer = opts.clock ?? Date.now;
  const deadline = timer() + (opts.budgetMs ?? REMINDER_BUDGET_MS);
  const ctx: Ctx = {
    db, now: opts.now, clock: vnClock(opts.now), deliver: opts.deliver,
    outOfTime: () => timer() >= deadline, log: opts.log ?? ((m) => console.warn(m)),
  };
  const first = await classReminders(ctx);
  const second = first.stopped ? { ...ZERO, stopped: true } : await thresholdNotices(ctx);
  const tally = add(first, second);
  if (second.stopped || ctx.outOfTime()) return { ...tally, pruned: 0, complete: false };
  const pruned = await housekeeping(ctx, opts.prune ?? defaultPrune);
  return { ...tally, pruned, complete: true };
}

/**
 * Bộ gửi mặc định: mọi thiết bị của người nhận qua `sendToUser` (dọn đăng ký hết hạn/lỗi). null khi VAPID chưa đặt
 * hoặc sai (chỉ dọn dẹp). `send` chỉ để test.
 */
export function pushDeliver(db: Db, env: Record<string, string | undefined>, send?: PushSender): Deliver | null {
  const vapid = checkVapid(env);
  if (vapid.status !== "ok") return null;
  return (userId, message) => sendToUser(db, userId, message, { vapid: vapid.config, send });
}
