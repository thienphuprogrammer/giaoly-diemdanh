import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { attendance, auditEvents, classCatechists, classes, grades, notificationLog, pushSubscriptions, sessions, students, users } from "@/db/schema";
import type { Db } from "@/db/types";
import type { PushMessage } from "@/lib/push/payload";
import type { PushOutcome } from "@/lib/push/send";
import { createTestDb } from "@/test/db";
import { seedBasics, type Basics } from "@/test/fixtures";
import { REMINDER_BUDGET_MS, pushDeliver, runReminders, type Deliver } from "./reminders";

/** Giờ Việt Nam (+07). 2026-10-11 là Chủ nhật, trong "Học kỳ 1" (2026-09-01 → 2027-01-15) của seedBasics. */
const vn = (iso: string) => new Date(`${iso}+07:00`);
const SUNDAY = "2026-10-11";
const at = (hhmm: string, date = SUNDAY) => vn(`${date}T${hhmm}:00`);

const keys = () => ({ p256dh: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString("base64url"), auth: randomBytes(16).toString("base64url") });

interface Captured { userId: string; message: PushMessage }

/** Bộ gửi giả: ghi lại mọi thông báo; `fail` = các người dùng mà mọi thiết bị đều không nhận. */
function fakeDeliver(opts: { fail?: Set<string>; throwFor?: Set<string>; onSend?: () => void } = {}) {
  const captured: Captured[] = [];
  const deliver: Deliver = async (userId, message) => {
    opts.onSend?.();
    captured.push({ userId, message });
    if (opts.throwFor?.has(userId)) throw new Error("network down");
    return opts.fail?.has(userId) ? { sent: 0, failed: 1, removed: 0 } : { sent: 1, failed: 0, removed: 0 };
  };
  return { deliver, captured };
}

async function addDevice(db: Db, userId: string) {
  await db.insert(pushSubscriptions).values({ userId, endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString("hex")}`, ...keys() });
}

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  await db.update(classes).set({ meetsOn: 0, meetsAt: "08:00" }).where(eq(classes.id, b.classId));
  const [glv2] = await db.insert(users).values({ email: "glv2@x.vn", name: "GLV Hai", passwordHash: "x", gradeId: b.gradeId }).returning();
  await db.insert(classCatechists).values({ classId: b.classId, userId: glv2.id });
  await addDevice(db, b.glv.id);
  await addDevice(db, glv2.id);
  await addDevice(db, b.head.id);
  return { db, b, glv2 };
}

const run = (db: Db, now: Date, deliver: Deliver | null, extra: Partial<Parameters<typeof runReminders>[1]> = {}) =>
  runReminders(db, { now, deliver, ...extra });

const logRows = (db: Db, kind?: string) => db.select().from(notificationLog).where(kind ? eq(notificationLog.kind, kind) : undefined);

async function session(db: Db, b: Basics, heldOn: string, extra: Partial<typeof sessions.$inferInsert> = {}) {
  const [s] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn, ...extra }).returning();
  return s;
}

const kid = async (db: Db, classId: string, fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
  (await db.insert(students).values({ classId, fullName, parentPhone: "0901234567", ...extra }).returning())[0];

const reminders = (c: Captured[]) => c.filter((x) => x.message.title === "Chưa điểm danh");

describe("runReminders: nhắc điểm danh", () => {
  it("cửa sổ: +29 phút chưa nhắc, +30 phút nhắc cả hai GLV, từ +3 giờ thôi nhắc", async () => {
    const { db, b, glv2 } = await setup();
    const early = fakeDeliver();
    await run(db, at("08:29"), early.deliver);
    expect(reminders(early.captured)).toEqual([]);

    const late = fakeDeliver();
    await run(db, at("11:00"), late.deliver);
    expect(reminders(late.captured)).toEqual([]);

    const due = fakeDeliver();
    const s = await run(db, at("08:30"), due.deliver);
    expect(reminders(due.captured).map((c) => c.userId).sort()).toEqual([b.glv.id, glv2.id].sort());
    expect(reminders(due.captured)[0].message).toEqual({ title: "Chưa điểm danh", body: "Lớp A chưa điểm danh hôm nay", url: `/lop/${b.classId}/diem-danh/${SUNDAY}` });
    expect(s).toMatchObject({ sent: 2, failed: 0, complete: true });
    const rows = await logRows(db, "class_reminder");
    expect(rows.map((r) => r.targetKey)).toEqual([`${b.classId}:${SUNDAY}`, `${b.classId}:${SUNDAY}`]);
  });

  it("không nhắc ngày khác thứ học hoặc lớp chưa đặt lịch", async () => {
    const { db, b } = await setup();
    const monday = fakeDeliver();
    await run(db, at("08:30", "2026-10-12"), monday.deliver);
    expect(reminders(monday.captured)).toEqual([]);
    await db.update(classes).set({ meetsOn: null, meetsAt: null }).where(eq(classes.id, b.classId));
    const none = fakeDeliver();
    await run(db, at("08:30"), none.deliver);
    expect(reminders(none.captured)).toEqual([]);
  });

  it("buổi học hôm nay đã có dòng điểm danh thì không nhắc; buổi mở mà trống thì vẫn nhắc", async () => {
    const { db, b } = await setup();
    const s = await session(db, b, SUNDAY);
    const empty = fakeDeliver();
    await run(db, at("08:30"), empty.deliver);
    expect(reminders(empty.captured)).toHaveLength(2);

    await db.delete(notificationLog);
    const k = await kid(db, b.classId, "Nguyễn Văn Em");
    await db.insert(attendance).values({ sessionId: s.id, studentId: k.id, status: "present" });
    const marked = fakeDeliver();
    await run(db, at("08:40"), marked.deliver);
    expect(reminders(marked.captured)).toEqual([]);
  });

  it("buổi bị huỷ (nghỉ lễ) thì không nhắc; buổi đi lễ cùng ngày có dòng vẫn không tính là đã điểm danh buổi học", async () => {
    const { db, b } = await setup();
    const k = await kid(db, b.classId, "Nguyễn Văn Em");
    const mass = await session(db, b, SUNDAY, { kind: "mass" });
    await db.insert(attendance).values({ sessionId: mass.id, studentId: k.id, status: "present" });
    const withMass = fakeDeliver();
    await run(db, at("08:30"), withMass.deliver);
    expect(reminders(withMass.captured)).toHaveLength(2);

    await db.delete(notificationLog);
    await session(db, b, SUNDAY, { cancelled: true });
    const cancelled = fakeDeliver();
    await run(db, at("08:30"), cancelled.deliver);
    expect(reminders(cancelled.captured)).toEqual([]);
  });

  it("chạy lại không gửi trùng; hai lần chạy chồng nhau cũng chỉ gửi một lần mỗi người", async () => {
    const { db } = await setup();
    const first = fakeDeliver();
    await run(db, at("08:30"), first.deliver);
    const again = fakeDeliver();
    const s = await run(db, at("08:40"), again.deliver);
    expect(reminders(again.captured)).toEqual([]);
    expect(s.sent).toBe(0);
    expect(s.skipped).toBeGreaterThan(0);

    await db.delete(notificationLog);
    const shared = fakeDeliver();
    await Promise.all([run(db, at("08:50"), shared.deliver), run(db, at("08:50"), shared.deliver)]);
    expect(reminders(shared.captured)).toHaveLength(2);
  });

  it("người không có thiết bị nào bị bỏ qua lặng lẽ (không ghi nhật ký, để bật thông báo sau vẫn nhận được)", async () => {
    const { db, b, glv2 } = await setup();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, glv2.id));
    const d = fakeDeliver();
    const s = await run(db, at("08:30"), d.deliver);
    expect(reminders(d.captured).map((c) => c.userId)).toEqual([b.glv.id]);
    expect(s.skipped).toBeGreaterThanOrEqual(1);
    expect((await logRows(db, "class_reminder")).map((r) => r.userId)).toEqual([b.glv.id]);
  });

  it("trưởng khối không được phân công lớp thì không nhận nhắc điểm danh", async () => {
    const { db, b } = await setup();
    const d = fakeDeliver();
    await run(db, at("08:30"), d.deliver);
    expect(reminders(d.captured).map((c) => c.userId)).not.toContain(b.head.id);
  });

  it("gửi lỗi không làm hỏng lần chạy và không gửi lại ở lần sau (dòng nhật ký được giữ)", async () => {
    const { db, b, glv2 } = await setup();
    const d = fakeDeliver({ throwFor: new Set([b.glv.id]), fail: new Set([glv2.id]) });
    const s = await run(db, at("08:30"), d.deliver);
    expect(s).toMatchObject({ sent: 0, failed: 2, complete: true });
    const next = fakeDeliver();
    await run(db, at("08:40"), next.deliver);
    expect(reminders(next.captured)).toEqual([]);
  });

  it("chưa cấu hình push (không có bộ gửi): không ghi nhật ký, đếm là bỏ qua", async () => {
    const { db } = await setup();
    const s = await run(db, at("08:30"), null);
    expect(s).toMatchObject({ sent: 0, failed: 0 });
    expect(s.skipped).toBeGreaterThanOrEqual(2);
    expect(await logRows(db, "class_reminder")).toEqual([]);
  });

  it("dùng bộ gửi thật (sendToUser) với sender giả: lỗi tạm thời được đếm và đăng ký được cập nhật bộ đếm", async () => {
    const { db, b } = await setup();
    const outcomes: PushOutcome[] = [];
    const deliver = pushDeliver(db, vapidEnv(), async () => { outcomes.push("retry"); return { outcome: "retry", status: 503 }; });
    expect(deliver).not.toBeNull();
    const s = await run(db, at("08:30"), deliver);
    expect(s).toMatchObject({ sent: 0, failed: 2 });
    const [sub] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, b.glv.id));
    expect(sub.failureCount).toBe(1);
  });
});

function vapidEnv() {
  const k = webpush.generateVAPIDKeys();
  return { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "mailto:a@giaoxu.vn" };
}

describe("pushDeliver", () => {
  it("VAPID chưa đặt hoặc sai: null (không gửi)", async () => {
    const db = await createTestDb();
    expect(pushDeliver(db, {})).toBeNull();
    expect(pushDeliver(db, { VAPID_PUBLIC_KEY: "x", VAPID_PRIVATE_KEY: "y", VAPID_SUBJECT: "mailto:a@b.vn" })).toBeNull();
  });
});

describe("runReminders: thông báo ngưỡng cho trưởng khối", () => {
  /** Hai buổi học vắng không phép trong học kỳ => cảnh báo (quy tắc ≥ 2 hiện hành). */
  async function absentTwice(db: Db, b: Basics, studentIds: string[], classId = b.classId) {
    for (const heldOn of ["2026-09-20", "2026-09-27"]) {
      const [s] = await db.insert(sessions).values({ classId, termId: b.termId, heldOn }).onConflictDoNothing().returning();
      const sid = s?.id ?? (await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.heldOn, heldOn), eq(sessions.kind, "class"))))[0].id;
      await db.insert(attendance).values(studentIds.map((studentId) => ({ sessionId: sid, studentId, status: "absent_unexcused" as const })));
    }
  }
  const heads = (c: Captured[], title: string) => c.filter((x) => x.message.title === title);
  const NOON = at("13:00"); // ngoài cửa sổ nhắc điểm danh

  it("em chạm ngưỡng vắng học: báo trưởng khối của khối đó đúng một lần mỗi em/học kỳ; em thứ hai sau đó báo riêng", async () => {
    const { db, b } = await setup();
    await addDevice(db, b.otherGlv.id);
    const [otherHead] = await db.insert(users).values({ email: "head2@x.vn", name: "Trưởng Hai", passwordHash: "x", gradeId: b.otherGradeId, isGradeHead: true }).returning();
    await addDevice(db, otherHead.id);
    const a = await kid(db, b.classId, "Trần Thị Ngưỡng");
    const c = await kid(db, b.classId, "Lê Văn Sau");
    await absentTwice(db, b, [a.id]);

    const first = fakeDeliver();
    await run(db, NOON, first.deliver);
    const sent = heads(first.captured, "Cảnh báo vắng học");
    expect(sent).toEqual([{ userId: b.head.id, message: { title: "Cảnh báo vắng học", body: "Có 1 em đạt ngưỡng cảnh báo vắng học (Lớp A)", url: "/can-chu-y" } }]);
    expect((await logRows(db, "absence_threshold")).map((r) => [r.targetKey, r.userId])).toEqual([[`${a.id}:${b.termId}`, b.head.id]]);

    const again = fakeDeliver();
    await run(db, at("13:10"), again.deliver);
    expect(heads(again.captured, "Cảnh báo vắng học")).toEqual([]);

    await absentTwice(db, b, [c.id]);
    const later = fakeDeliver();
    await run(db, at("13:20"), later.deliver);
    expect(heads(later.captured, "Cảnh báo vắng học").map((x) => x.message.body)).toEqual(["Có 1 em đạt ngưỡng cảnh báo vắng học (Lớp A)"]);
  });

  it("gộp mỗi trưởng khối một thông báo mỗi lần chạy, kể cả nhiều lớp trong khối", async () => {
    const { db, b } = await setup();
    const [cls2] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp C" }).returning();
    const kids = [await kid(db, b.classId, "Em Một"), await kid(db, b.classId, "Em Hai")];
    const k3 = await kid(db, cls2.id, "Em Ba");
    await absentTwice(db, b, kids.map((k) => k.id));
    await absentTwice(db, b, [k3.id], cls2.id);
    const d = fakeDeliver();
    await run(db, NOON, d.deliver);
    expect(heads(d.captured, "Cảnh báo vắng học").map((x) => [x.userId, x.message.body]))
      .toEqual([[b.head.id, "Có 3 em đạt ngưỡng cảnh báo vắng học ở Lớp A, Lớp C"]]);
    expect(await logRows(db, "absence_threshold")).toHaveLength(3);
  });

  it("chỉ em đang học ở lớp: em đã nghỉ hoặc đã chuyển sang khối khác không được báo cho khối này", async () => {
    const { db, b } = await setup();
    const gone = await kid(db, b.classId, "Em Đã Nghỉ");
    const moved = await kid(db, b.classId, "Em Chuyển Đi");
    await absentTwice(db, b, [gone.id, moved.id]);
    await db.update(students).set({ active: false }).where(eq(students.id, gone.id));
    await db.update(students).set({ classId: b.otherClassId }).where(eq(students.id, moved.id));
    const d = fakeDeliver();
    await run(db, NOON, d.deliver);
    expect(heads(d.captured, "Cảnh báo vắng học")).toEqual([]);
  });

  it("vắng không phép ở buổi đi lễ không tính vào ngưỡng vắng học; ngoài học kỳ hiện tại thì không báo", async () => {
    const { db, b } = await setup();
    const a = await kid(db, b.classId, "Em Lễ");
    for (const heldOn of ["2026-09-20", "2026-09-27"]) {
      const s = await session(db, b, heldOn, { kind: "mass" });
      await db.insert(attendance).values({ sessionId: s.id, studentId: a.id, status: "absent_unexcused" });
    }
    const d = fakeDeliver();
    await run(db, NOON, d.deliver);
    expect(heads(d.captured, "Cảnh báo vắng học")).toEqual([]);

    const k = await kid(db, b.classId, "Em Học Kỳ Khác");
    await absentTwice(db, b, [k.id]);
    const outside = fakeDeliver();
    await run(db, vn("2027-03-01T13:00:00"), outside.deliver); // sau học kỳ 1, chưa có học kỳ khác
    expect(outside.captured.filter((x) => x.message.title.startsWith("Cảnh báo"))).toEqual([]);
  });

  it("ngưỡng đi lễ theo missedMassWeeks: tuần huỷ/tuần rỗng không tính, em mới vào lớp chỉ tính từ dòng đầu tiên", async () => {
    const { db, b } = await setup();
    const [regular, joiner, ok] = [await kid(db, b.classId, "Em Vắng Lễ"), await kid(db, b.classId, "Em Mới Vào"), await kid(db, b.classId, "Em Đi Đều")];
    // Buổi học đầu kỳ: hai em cũ có dòng từ đầu.
    const enrol = await session(db, b, "2026-09-05");
    await db.insert(attendance).values([regular, ok].map((k) => ({ sessionId: enrol.id, studentId: k.id, status: "present" as const })));
    const w1 = await session(db, b, "2026-09-13", { kind: "mass" });
    const w2 = await session(db, b, "2026-09-20", { kind: "mass" });
    const cancelled = await session(db, b, "2026-09-27", { kind: "mass", cancelled: true });
    await session(db, b, "2026-10-04", { kind: "mass" }); // tuần mở mà rỗng
    await db.insert(attendance).values([
      { sessionId: w1.id, studentId: ok.id, status: "present" },
      { sessionId: w1.id, studentId: regular.id, status: "absent_unexcused" }, // vắng có dòng
      { sessionId: w2.id, studentId: ok.id, status: "present" }, // regular không có dòng => vẫn vắng
      { sessionId: cancelled.id, studentId: ok.id, status: "present" },
      { sessionId: cancelled.id, studentId: joiner.id, status: "absent_unexcused" },
    ]);
    // joiner: dòng đầu tiên ở tuần huỷ (27/9), sau w1/w2 => chưa tuần nào được tính.
    const d = fakeDeliver();
    await run(db, NOON, d.deliver);
    expect(heads(d.captured, "Cảnh báo vắng lễ").map((x) => x.message.body)).toEqual(["Có 1 em đạt ngưỡng cảnh báo vắng lễ (Lớp A)"]);
    expect((await logRows(db, "mass_threshold")).map((r) => r.targetKey)).toEqual([`${regular.id}:${b.termId}`]);

    // Trưởng khối nâng ngưỡng lên 3: em đã được báo không bị báo lại, em khác cũng không chạm.
    await db.update(grades).set({ massThreshold: 3 }).where(eq(grades.id, b.gradeId));
    const after = fakeDeliver();
    await run(db, at("13:10"), after.deliver);
    expect(heads(after.captured, "Cảnh báo vắng lễ")).toEqual([]);
  });

  it("vắng học và vắng lễ là hai loại riêng: cùng một em có thể được báo một lần cho mỗi loại", async () => {
    const { db, b } = await setup();
    const a = await kid(db, b.classId, "Em Hai Loại");
    await absentTwice(db, b, [a.id]);
    for (const heldOn of ["2026-09-21", "2026-09-28"]) {
      const s = await session(db, b, heldOn, { kind: "mass" });
      await db.insert(attendance).values({ sessionId: s.id, studentId: a.id, status: "absent_unexcused" });
    }
    const d = fakeDeliver();
    await run(db, NOON, d.deliver);
    expect(d.captured.map((x) => x.message.title).sort()).toEqual(["Cảnh báo vắng học", "Cảnh báo vắng lễ"]);
  });

  it("trưởng khối không có thiết bị: bỏ qua, không ghi nhật ký", async () => {
    const { db, b } = await setup();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, b.head.id));
    const a = await kid(db, b.classId, "Em Không Báo");
    await absentTwice(db, b, [a.id]);
    const d = fakeDeliver();
    const s = await run(db, NOON, d.deliver);
    expect(d.captured).toEqual([]);
    expect(s.skipped).toBeGreaterThanOrEqual(1);
    expect(await logRows(db, "absence_threshold")).toEqual([]);
  });

  it("gửi cho trưởng khối lỗi: lần sau không gửi lại", async () => {
    const { db, b } = await setup();
    const a = await kid(db, b.classId, "Em Lỗi Gửi");
    await absentTwice(db, b, [a.id]);
    const d = fakeDeliver({ throwFor: new Set([b.head.id]) });
    const s = await run(db, NOON, d.deliver);
    expect(s.failed).toBe(1);
    const next = fakeDeliver();
    await run(db, at("13:10"), next.deliver);
    expect(next.captured).toEqual([]);
  });
});

describe("runReminders: nội dung không lộ thông tin em", () => {
  it("không thông báo nào chứa tên đầy đủ hay số điện thoại của em", async () => {
    const { db, b } = await setup();
    const names = ["Nguyễn Thị Bí Mật", "Phạm Văn Riêng Tư"];
    const kids = [await kid(db, b.classId, names[0], { parentPhone: "0912345678" }), await kid(db, b.classId, names[1], { parentPhone: "0987654321" })];
    for (const heldOn of ["2026-09-20", "2026-09-27"]) {
      const s = await session(db, b, heldOn);
      await db.insert(attendance).values(kids.map((k) => ({ sessionId: s.id, studentId: k.id, status: "absent_unexcused" as const })));
      const m = await session(db, b, heldOn.replace("-2", "-1"), { kind: "mass" });
      await db.insert(attendance).values(kids.map((k) => ({ sessionId: m.id, studentId: k.id, status: "absent_unexcused" as const })));
    }
    const d = fakeDeliver();
    await run(db, at("08:30"), d.deliver);
    expect(d.captured.length).toBeGreaterThanOrEqual(4); // 2 nhắc điểm danh + vắng học + vắng lễ
    const dump = JSON.stringify(d.captured.map((c) => c.message));
    for (const s of [...names, ...names.flatMap((n) => n.split(" ").slice(1)), "0912345678", "0987654321", ...kids.map((k) => k.id)]) {
      expect(dump).not.toContain(s);
    }
  });
});

describe("runReminders: ngân sách thời gian", () => {
  it("hết ngân sách thì dừng gọn (complete=false); lần chạy sau làm tiếp phần còn lại", async () => {
    const { db, b } = await setup();
    expect(REMINDER_BUDGET_MS).toBe(25_000);
    const [cls2] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp C", meetsOn: 0, meetsAt: "08:00" }).returning();
    await db.insert(classCatechists).values({ classId: cls2.id, userId: b.glv.id });
    let t = 0;
    const d = fakeDeliver({ onSend: () => { t += 20_000; } });
    const s = await run(db, at("08:30"), d.deliver, { clock: () => t, budgetMs: REMINDER_BUDGET_MS });
    expect(s.complete).toBe(false);
    const firstClassIds = new Set(reminders(d.captured).map((c) => c.message.url));
    expect(firstClassIds.size).toBe(1);
    expect(s.pruned).toBe(0);

    const rest = fakeDeliver();
    const s2 = await run(db, at("08:40"), rest.deliver);
    expect(s2.complete).toBe(true);
    const second = new Set(reminders(rest.captured).map((c) => c.message.url));
    expect(second.size).toBe(1);
    expect([...second][0]).not.toBe([...firstClassIds][0]);
  });
});

describe("runReminders: dọn dẹp mỗi ngày một lần", () => {
  it("xoá nhật ký thay đổi > 365 ngày và nhật ký thông báo cũ, giữ thông báo ngưỡng của học kỳ còn chạy", async () => {
    const { db, b } = await setup();
    const now = at("13:00");
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    await db.insert(auditEvents).values([
      { at: daysAgo(400), classId: b.classId, entity: "class", action: "class.schedule" },
      { at: daysAgo(10), classId: b.classId, entity: "class", action: "class.schedule" },
    ]);
    await db.insert(notificationLog).values([
      { kind: "class_reminder", targetKey: "old", userId: b.glv.id, sentAt: daysAgo(121) },
      { kind: "class_reminder", targetKey: "recent", userId: b.glv.id, sentAt: daysAgo(100) },
      { kind: "absence_threshold", targetKey: "term-long", userId: b.head.id, sentAt: daysAgo(130) },
      { kind: "mass_threshold", targetKey: "ancient", userId: b.head.id, sentAt: daysAgo(500) },
    ]);
    const s = await run(db, now, fakeDeliver().deliver);
    expect(s.pruned).toBe(3); // 1 audit + 1 nhắc cũ + 1 ngưỡng rất cũ
    expect((await db.select().from(auditEvents)).length).toBe(1);
    expect((await logRows(db)).map((r) => r.targetKey).sort()).toEqual(["2026-10-11", "recent", "term-long"].sort());

    await db.insert(auditEvents).values({ at: daysAgo(400), classId: b.classId, entity: "class", action: "class.schedule" });
    const sameDay = await run(db, at("18:00"), fakeDeliver().deliver);
    expect(sameDay.pruned).toBe(0);
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(auditEvents)).toEqual([{ n: 2 }]);

    const nextDay = await run(db, vn("2026-10-12T00:10:00"), fakeDeliver().deliver);
    expect(nextDay.pruned).toBe(1);
  });

  it("dọn dẹp vẫn chạy khi chưa cấu hình push", async () => {
    const { db, b } = await setup();
    await db.insert(auditEvents).values({ at: vn("2025-01-01T00:00:00"), classId: b.classId, entity: "class", action: "class.schedule" });
    const s = await run(db, at("13:00"), null);
    expect(s.pruned).toBe(1);
  });

  it("dọn dẹp lỗi thì nhả lượt hôm nay để lần sau thử lại, lần chạy không hỏng", async () => {
    const { db, b } = await setup();
    await db.insert(auditEvents).values({ at: vn("2025-01-01T00:00:00"), classId: b.classId, entity: "class", action: "class.schedule" });
    const log = vi.fn();
    const broken = await run(db, at("13:00"), null, { prune: async () => { throw new Error("db down"); }, log });
    expect(broken).toMatchObject({ pruned: 0, complete: true });
    expect(log).toHaveBeenCalled();
    const retry = await run(db, at("13:10"), null);
    expect(retry.pruned).toBe(1);
  });
});
