import { massGrid } from "@/db/queries/mass-stats";
import {
  catechistsOf, claimNotifications, classNamesOfGrades, currentTerm, gradeHeads, pruneNotificationLog, releaseNotification,
  scheduledClasses, type Recipient,
} from "@/db/queries/reminders";
import { termRecords, termRoster } from "@/db/queries/stats";
import type { Db } from "@/db/types";
import { isMassWarning, tallyMass } from "@/lib/attendance/mass-tally";
import { isActionable } from "@/lib/promotion";
import type { PushMessage } from "@/lib/push/payload";
import type { PushSender } from "@/lib/push/send-many";
import { checkVapid } from "@/lib/push/vapid";
import {
  THRESHOLD_KINDS, classReminderKey, classReminderMessage, thresholdKey, thresholdMessage, type ReminderKind, type ThresholdKind,
} from "@/lib/reminders/messages";
import { isClassReminderDue, vnClock, type VnClock } from "@/lib/reminders/schedule";
import type { CronSummary } from "../http/cron";
import { pruneAudit } from "../audit-retention";
import { sendToUser } from "./push";
import { buildRows } from "./stats";

/**
 * Tác vụ nhắc việc (spec §4), gọi từ `/api/cron/nhac-viec` mỗi ~10 phút:
 * 1. nhắc GLV được phân công khi 30 phút–3 giờ sau giờ học mà buổi HỌC hôm nay chưa có dấu điểm danh nào (bỏ buổi huỷ);
 *    chỉ khi hôm nay nằm trong một học kỳ và lớp còn em đang học; một lần mỗi (lớp, ngày) mỗi GLV;
 * 2. báo trưởng khối khi em đang học ở lớp đang ở trạng thái cảnh báo vắng học hoặc vắng lễ trong học kỳ hiện tại; một
 *    lần mỗi (em, học kỳ, loại) mỗi trưởng khối, GỘP thành một thông báo mỗi trưởng khối mỗi loại mỗi lần chạy. Lần chạy
 *    đầu tiên sau khi triển khai (hoặc sau khi trưởng khối bật thông báo) gửi MỘT thông báo gộp cho các cảnh báo đang có;
 * 3. dọn dẹp mỗi ngày một lần: nhật ký thay đổi > 365 ngày, `notification_log` cũ.
 *
 * Idempotent bằng "nhận trước khi gửi": dòng `notification_log` được chèn TRƯỚC khi gửi và chỉ gửi khi chèn được.
 * - Tới được ít nhất một thiết bị (`ok`): GIỮ dòng, không gửi lại.
 * - Không tới được thiết bị nào: NHẢ dòng để lần chạy sau thử lại. Gồm lỗi tạm thời/xác thực/cục bộ (đếm `failed`; mỗi
 *   lần thử tăng bộ đếm lỗi của đăng ký nên đăng ký hỏng mãi sẽ bị xoá sau 5 hoặc 10 lần, giới hạn số lần thử lại) và
 *   trường hợp mọi thiết bị vừa hết hạn/bị xoá (đếm `skipped`: người đó sẽ nhận khi bật lại thông báo).
 * Người nhận không có thiết bị nào (hoặc server chưa cấu hình VAPID) thì bỏ qua và KHÔNG ghi dòng.
 * Ngân sách thời gian 20 giây (route có `maxDuration` 60): kiểm trước MỖI lần nhận khoá và sau phần tính ngưỡng; hết thì
 * dừng gọn (`truncated`), lần chạy sau làm tiếp.
 */
export const REMINDER_BUDGET_MS = 20_000;
export const AUDIT_PRUNE_DAYS = 365;

export type Deliver = (userId: string, message: PushMessage) => Promise<{ sent: number; failed: number; removed: number }>;

export interface ThresholdHit { kind: ThresholdKind; studentId: string; classId: string }

/**
 * Các em ĐANG học ở lớp (không gồm em đã nghỉ/đã chuyển lớp) đang ở trạng thái cảnh báo trong học kỳ, cùng định nghĩa
 * với "Cần chú ý": vắng học qua `buildRows` (buổi HỌC không huỷ, vắng không phép ≥ ngưỡng hiện hành); vắng lễ qua
 * `tallyMass` (tuần đã ghi nhận, bỏ tuần huỷ/rỗng, tính từ dòng đầu tiên của em) ≥ `grades.mass_threshold`.
 */
export async function thresholdHits(db: Db, classIds: string[], term: { id: string; endsOn: string }, today: string): Promise<ThresholdHit[]> {
  if (classIds.length === 0) return [];
  const [roster, records, grid] = await Promise.all([
    termRoster(db, classIds, term, today), termRecords(db, classIds, term.id), massGrid(db, { classIds, termId: term.id }),
  ]);
  const absence = buildRows(roster, records)
    .filter((r) => isActionable(r) && r.summary.warning.level === "warning")
    .map((r): ThresholdHit => ({ kind: "absence_threshold", studentId: r.studentId, classId: r.classId }));
  const mass = grid.students
    .filter((s) => isActionable(s) && isMassWarning(tallyMass(grid.weeks.get(s.classId) ?? [], s.firstSeen, s.attended).missed, s.threshold))
    .map((s): ThresholdHit => ({ kind: "mass_threshold", studentId: s.id, classId: s.classId }));
  return [...absence, ...mass];
}

export interface ReminderOptions {
  now: Date;
  /** null = thông báo đẩy chưa cấu hình: chỉ dọn dẹp. */
  deliver: Deliver | null;
  /** Đồng hồ cho ngân sách thời gian (ms); mặc định `Date.now`. */
  clock?: () => number;
  budgetMs?: number;
  /** Dọn dẹp hằng ngày; trả số dòng đã xoá. Mặc định nhật ký thay đổi + nhật ký thông báo. */
  prune?: (db: Db, now: Date) => Promise<number>;
  /** Chỉ để test (đo ngân sách quanh phần tính ngưỡng). */
  thresholdHits?: typeof thresholdHits;
  log?: (message: string) => void;
}

interface Tally { sent: number; skipped: number; failed: number }
const ZERO: Tally = { sent: 0, skipped: 0, failed: 0 };
const SENT: Tally = { sent: 1, skipped: 0, failed: 0 };
const SKIPPED: Tally = { sent: 0, skipped: 1, failed: 0 };
const FAILED: Tally = { sent: 0, skipped: 0, failed: 1 };
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
const STOPPED = (t: Tally): Step => ({ ...t, stopped: true });
const DONE = (t: Tally): Step => ({ ...t, stopped: false });

/** Gửi; trả về kết quả đếm. `ok` khi tới ít nhất một thiết bị; `gone` khi mọi thiết bị vừa bị xoá và không lỗi nào khác. */
async function deliverSafely(ctx: Ctx, deliver: Deliver, userId: string, message: PushMessage): Promise<"ok" | "gone" | "failed"> {
  try {
    const r = await deliver(userId, message);
    if (r.sent > 0) return "ok";
    return r.failed === 0 && r.removed > 0 ? "gone" : "failed";
  } catch {
    ctx.log("reminders: deliver failed"); // không in lỗi (có thể chứa endpoint)
    return "failed";
  }
}

/** Nhận các khoá cho một người nhận, gửi một thông báo dựng từ các khoá vừa nhận; không tới thiết bị nào thì nhả khoá. */
async function notify(ctx: Ctx, kind: ReminderKind, recipient: Recipient, keys: readonly string[], build: (fresh: Set<string>) => PushMessage): Promise<Tally> {
  if (!ctx.deliver || !recipient.hasDevice) return SKIPPED;
  const fresh = await claimNotifications(ctx.db, kind, keys, recipient.userId);
  if (fresh.size === 0) return SKIPPED;
  const result = await deliverSafely(ctx, ctx.deliver, recipient.userId, build(fresh));
  if (result === "ok") return SENT;
  for (const key of fresh) await releaseNotification(ctx.db, kind, key, recipient.userId);
  return result === "gone" ? SKIPPED : FAILED;
}

async function classReminders(ctx: Ctx): Promise<Step> {
  const { date } = ctx.clock;
  // Chỉ nhắc trong học kỳ (không nhắc dịp hè / giữa hai học kỳ).
  if (!(await currentTerm(ctx.db, date))) return DONE(ZERO);
  const due = (await scheduledClasses(ctx.db, ctx.clock.weekday, date))
    .filter((c) => isClassReminderDue(c, ctx.clock) && !c.cancelled && !c.marked);
  const recipients = await catechistsOf(ctx.db, due.map((c) => c.id));
  let tally = ZERO;
  for (const cls of due) {
    const key = classReminderKey(cls.id, date);
    for (const r of recipients.filter((x) => x.classId === cls.id)) {
      if (ctx.outOfTime()) return STOPPED(tally);
      tally = add(tally, await notify(ctx, "class_reminder", r, [key], () => classReminderMessage(cls, date)));
    }
  }
  return DONE(tally);
}

async function thresholdNotices(ctx: Ctx, hitsOf: typeof thresholdHits): Promise<Step> {
  const heads = await gradeHeads(ctx.db);
  const term = heads.length > 0 ? await currentTerm(ctx.db, ctx.clock.date) : null;
  if (!term) return DONE(ZERO);
  const classList = await classNamesOfGrades(ctx.db, [...new Set(heads.map((h) => h.gradeId))]);
  if (ctx.outOfTime()) return STOPPED(ZERO);
  const gradeOf = new Map(classList.map((c) => [c.id, c.gradeId]));
  const nameOf = new Map(classList.map((c) => [c.id, c.name]));
  const hits = await hitsOf(ctx.db, classList.map((c) => c.id), term, ctx.clock.date);
  let tally = ZERO;
  for (const kind of THRESHOLD_KINDS) {
    for (const head of heads) {
      const mine = hits.filter((h) => h.kind === kind && gradeOf.get(h.classId) === head.gradeId);
      if (mine.length === 0) continue;
      if (ctx.outOfTime()) return STOPPED(tally);
      const keyOf = (h: ThresholdHit) => thresholdKey(h.studentId, term.id);
      tally = add(tally, await notify(ctx, kind, head, mine.map(keyOf), (fresh) =>
        thresholdMessage(kind, mine.filter((h) => fresh.has(keyOf(h))).map((h) => nameOf.get(h.classId) ?? ""))));
    }
  }
  return DONE(tally);
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
  const second = first.stopped || ctx.outOfTime() ? STOPPED(ZERO) : await thresholdNotices(ctx, opts.thresholdHits ?? thresholdHits);
  const tally = add(first, second);
  if (second.stopped || ctx.outOfTime()) return { ...tally, pruned: 0, truncated: true };
  const pruned = await housekeeping(ctx, opts.prune ?? defaultPrune);
  return { ...tally, pruned, truncated: false };
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
