import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resolveTerm } from "@/db/queries/stats";
import { attendance, classCatechists, classes, grades, promotions, seatAssignments, seatingPlans, sessions, students, users } from "@/db/schema";
import { auditRows, breakAuditInserts, dataSnapshot } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { setNextGrade } from "./grade-settings";
import { applyPromotion, incomingNotices, listPromotions, previewPromotion, promotionTargets, undoPromotion } from "./promotions";
import { applyScan } from "./scan";
import { massAttentionList, massStats } from "./mass-stats";
import { attentionList, classStats, gradeOverview } from "./stats";
import { getStudentProfile } from "./student-profile";
import { classTermReport, gradeReport } from "./term-report";

const NOT_FOUND = "Không tìm thấy lớp";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  // Khối 1: Lớp A (nguồn), Lớp A2 (cùng khối). Khối 2 (của seedBasics) là khối kế tiếp; Khối 3 không liên quan.
  const [cls2] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp A2" }).returning();
  const [grade3] = await db.insert(grades).values({ name: "Khối 3" }).returning();
  const [unrelated] = await db.insert(classes).values({ gradeId: grade3.id, name: "Lớp D" }).returning();
  const mkUser = async (email: string, extra: Partial<typeof users.$inferInsert>) =>
    (await db.insert(users).values({ email, name: email, passwordHash: "x", ...extra }).returning())[0];
  const head2 = await mkUser("head2@x.vn", { isGradeHead: true, gradeId: b.gradeId });
  const otherHead = await mkUser("ohead@x.vn", { isGradeHead: true, gradeId: b.otherGradeId });
  const glv2 = await mkUser("glv2@x.vn", { gradeId: b.gradeId });
  await db.insert(classCatechists).values({ classId: cls2.id, userId: glv2.id });
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  const [an, binh, chi] = [await kid("An"), await kid("Bình"), await kid("Chi")];
  const nghi = await kid("Nghỉ", { active: false });
  const setNext = (next: string | null) => db.update(grades).set({ nextGradeId: next }).where(eq(grades.id, b.gradeId));
  const classOf = async (id: string) => (await db.select({ c: students.classId }).from(students).where(eq(students.id, id)))[0].c;
  const apply = (user: typeof b.head, studentIds: string[], extra: Record<string, unknown> = {}) =>
    applyPromotion(db, user, { fromClassId: b.classId, toClassId: cls2.id, studentIds, ...extra });
  return { db, b, cls2, unrelated, head2, otherHead, glv2, kid, an, binh, chi, nghi, setNext, classOf, apply };
}

describe("promotionTargets / previewPromotion", () => {
  it("lists own-grade classes as sources and same-grade + next-grade classes as targets (heads only)", async () => {
    const { db, b, setNext } = await setup();
    expect(await promotionTargets(db, b.glv)).toBeNull();
    const before = await promotionTargets(db, b.head);
    expect(before?.sources.map((c) => [c.name, c.activeCount])).toEqual([["Lớp A", 3], ["Lớp A2", 0]]);
    expect(before?.targets.map((c) => c.name)).toEqual(["Lớp A", "Lớp A2"]);
    expect(before?.nextGrade).toBeNull();
    await setNext(b.otherGradeId);
    const after = await promotionTargets(db, b.head);
    expect(after?.targets.map((c) => [c.name, c.gradeName, c.sameGrade])).toEqual([
      ["Lớp A", "Khối 1", true], ["Lớp A2", "Khối 1", true], ["Lớp B", "Khối 2", false],
    ]);
    expect(after?.nextGrade).toEqual({ id: b.otherGradeId, name: "Khối 2" });
  });

  it("previews the active students of the source, all selected; inactive ones are not listed", async () => {
    const { db, b, cls2 } = await setup();
    const r = await previewPromotion(db, b.head, { fromClassId: b.classId, toClassId: cls2.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.from).toEqual({ id: b.classId, name: "Lớp A" });
    expect(r.data.to).toEqual({ id: cls2.id, name: "Lớp A2", gradeName: "Khối 1" });
    expect(r.data.students.map((s) => [s.fullName, s.selected])).toEqual([["An", true], ["Bình", true], ["Chi", true]]);
    expect(JSON.stringify(r.data)).not.toMatch(/qrToken|parentPhone/);
  });

  it("refuses previews outside the head's reach like a missing class", async () => {
    const { db, b, cls2, unrelated, otherHead } = await setup();
    for (const [user, from, to] of [
      [b.glv, b.classId, cls2.id], [otherHead, b.classId, cls2.id], [b.head, b.classId, unrelated.id],
      [b.head, b.classId, b.classId], [b.head, "x", cls2.id], [b.head, b.classId, crypto.randomUUID()],
    ] as const) {
      expect(await previewPromotion(db, user, { fromClassId: from, toClassId: to })).toEqual({ ok: false, error: NOT_FOUND });
    }
  });
});

describe("applyPromotion: who and where", () => {
  it("moves chosen students to a class of the same grade, keeps QR tokens and writes one promotion + one audit row", async () => {
    const { db, b, cls2, an, binh, chi, classOf, apply } = await setup();
    const r = await apply(b.head, [an.id, binh.id]);
    expect(r).toMatchObject({ ok: true, data: { moved: 2, skipped: 0, seatsRemoved: 0 } });
    expect([await classOf(an.id), await classOf(binh.id), await classOf(chi.id)]).toEqual([cls2.id, cls2.id, b.classId]);
    const after = await db.select({ id: students.id, qrToken: students.qrToken }).from(students).where(inArray(students.id, [an.id, binh.id]));
    expect(new Map(after.map((s) => [s.id, s.qrToken]))).toEqual(new Map([[an.id, an.qrToken], [binh.id, binh.qrToken]]));
    const [promo] = await db.select().from(promotions);
    expect(promo).toMatchObject({ actorId: b.head.id, fromClassId: b.classId, toClassId: cls2.id, undoneAt: null });
    expect([...promo.studentIds].sort()).toEqual([an.id, binh.id].sort());
    // Một dòng nhật ký cho MỖI lớp liên quan (lớp cũ và lớp mới đều thấy trong Nhật ký của lớp), cùng transaction.
    const audit = await auditRows(db);
    expect(audit).toHaveLength(2);
    expect(audit.find((a) => a.classId === b.classId)).toMatchObject({
      actorId: b.head.id, gradeId: b.gradeId, entity: "promotion", entityId: promo.id, action: "promotion.apply",
      summary: { fromClass: "Lớp A", toClass: "Lớp A2", count: 2, skipped: 0, seatsRemoved: 0 },
    });
    expect(audit.find((a) => a.classId === cls2.id)).toMatchObject({
      actorId: b.head.id, gradeId: b.gradeId, entity: "promotion", entityId: promo.id, action: "promotion.apply",
      summary: { fromClass: "Lớp A", toClass: "Lớp A2", count: 2, direction: "in" },
    });
    expect(JSON.stringify(audit)).not.toContain(an.qrToken);
  });

  it("allows a class of the configured next grade, and only then", async () => {
    const { db, b, an, classOf, setNext } = await setup();
    const toB = () => applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: b.otherClassId, studentIds: [an.id] });
    expect(await toB()).toEqual({ ok: false, error: NOT_FOUND });
    await setNext(b.otherGradeId);
    expect(await toB()).toMatchObject({ ok: true, data: { moved: 1 } });
    expect(await classOf(an.id)).toBe(b.otherClassId);
  });

  it("refuses a target class in an unrelated grade, a source of another grade, catechists and the head of the next grade", async () => {
    const { db, b, cls2, unrelated, otherHead, glv2, an, setNext, classOf } = await setup();
    await setNext(b.otherGradeId);
    const attempts = [
      applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: unrelated.id, studentIds: [an.id] }),
      applyPromotion(db, b.head, { fromClassId: b.otherClassId, toClassId: b.classId, studentIds: [an.id] }),
      applyPromotion(db, b.glv, { fromClassId: b.classId, toClassId: cls2.id, studentIds: [an.id] }),
      applyPromotion(db, glv2, { fromClassId: b.classId, toClassId: cls2.id, studentIds: [an.id] }),
      applyPromotion(db, otherHead, { fromClassId: b.classId, toClassId: b.otherClassId, studentIds: [an.id] }),
      applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: b.classId, studentIds: [an.id] }),
    ];
    for (const r of await Promise.all(attempts)) expect(r).toEqual({ ok: false, error: NOT_FOUND });
    expect(await classOf(an.id)).toBe(b.classId);
    expect(await db.select().from(promotions)).toHaveLength(0);
    expect(await auditRows(db)).toHaveLength(0);
  });

  it("refuses inactive students and students of other classes (nothing moves)", async () => {
    const { db, b, an, nghi, kid, classOf, apply } = await setup();
    const stranger = await kid("Lạ", {}, b.otherClassId);
    for (const ids of [[an.id, nghi.id], [an.id, stranger.id], [an.id, crypto.randomUUID()]]) {
      const r = await apply(b.head, ids);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/không còn ở lớp|đã nghỉ/);
    }
    expect([await classOf(an.id), await classOf(nghi.id), await classOf(stranger.id)]).toEqual([b.classId, b.classId, b.otherClassId]);
    expect(await auditRows(db)).toHaveLength(0);
  });

  it("validates the input: at least one, at most 200 distinct ids", async () => {
    const { b, an, apply } = await setup();
    expect((await apply(b.head, [])).ok).toBe(false);
    expect((await apply(b.head, Array.from({ length: 201 }, () => crypto.randomUUID()))).ok).toBe(false);
    expect((await apply(b.head, ["nope"])).ok).toBe(false);
    expect((await apply(b.head, [an.id], { clientToken: "nope" })).ok).toBe(false);
    expect(await apply(b.head, [an.id, an.id])).toMatchObject({ ok: true, data: { moved: 1 } });
  });
});

describe("applyPromotion: double submit", () => {
  it("the same client token returns the first result and moves nothing more", async () => {
    const { db, b, an, binh, apply } = await setup();
    const clientToken = crypto.randomUUID();
    const first = await apply(b.head, [an.id, binh.id], { clientToken });
    const again = await apply(b.head, [an.id, binh.id], { clientToken });
    expect(again).toEqual(first);
    expect(await db.select().from(promotions)).toHaveLength(1);
    expect(await auditRows(db)).toHaveLength(2);
  });

  it("without a token, students already in the target are skipped; nothing left to move writes nothing", async () => {
    const { db, b, an, binh, apply } = await setup();
    await apply(b.head, [an.id]);
    expect(await apply(b.head, [an.id, binh.id])).toMatchObject({ ok: true, data: { moved: 1, skipped: 1 } });
    expect(await apply(b.head, [an.id, binh.id])).toEqual({ ok: true, data: { promotionId: null, moved: 0, skipped: 2, seatsRemoved: 0 } });
    expect(await db.select().from(promotions)).toHaveLength(2);
    expect((await auditRows(db)).filter((r) => r.classId === b.classId).map((r) => r.summary)).toEqual([
      { fromClass: "Lớp A", toClass: "Lớp A2", count: 1, skipped: 0, seatsRemoved: 0 },
      { fromClass: "Lớp A", toClass: "Lớp A2", count: 1, skipped: 1, seatsRemoved: 0 },
    ]);
    expect(await auditRows(db)).toHaveLength(4);
  });
});

describe("applyPromotion: seats", () => {
  it("removes the moved students' seats in the old class's plans only and records them for reference", async () => {
    const { db, b, cls2, an, binh, chi, apply } = await setup();
    const layout = [{ id: "r1", items: [{ type: "bench" as const, id: "b1", seats: 3 }] }];
    const [planA] = await db.insert(seatingPlans).values({ classId: b.classId, name: "Sơ đồ A", layout, isActive: true }).returning();
    const [planA2] = await db.insert(seatingPlans).values({ classId: b.classId, name: "Sơ đồ phụ", layout }).returning();
    const [planNew] = await db.insert(seatingPlans).values({ classId: cls2.id, name: "Sơ đồ mới", layout, isActive: true }).returning();
    await db.insert(seatAssignments).values([
      { planId: planA.id, benchId: "b1", seatIndex: 0, studentId: an.id },
      { planId: planA.id, benchId: "b1", seatIndex: 1, studentId: binh.id },
      { planId: planA.id, benchId: "b1", seatIndex: 2, studentId: chi.id },
      { planId: planA2.id, benchId: "b1", seatIndex: 0, studentId: an.id },
    ]);
    const r = await apply(b.head, [an.id, binh.id]);
    expect(r).toMatchObject({ ok: true, data: { moved: 2, seatsRemoved: 3 } });
    const left = await db.select().from(seatAssignments);
    expect(left.map((s) => [s.planId, s.studentId])).toEqual([[planA.id, chi.id]]);
    const [promo] = await db.select().from(promotions);
    expect(promo.removedSeats).toHaveLength(3);
    expect(promo.removedSeats).toContainEqual({ planId: planA2.id, benchId: "b1", seatIndex: 0, studentId: an.id });
    expect((await db.select().from(seatingPlans).where(eq(seatingPlans.id, planNew.id)))[0].layout).toEqual(layout);
  });
});

describe("after a promotion: history, stats and scanning", () => {
  async function withHistory() {
    const s = await setup();
    const { db, b, an, binh } = s;
    const old = await db.insert(sessions).values(["2026-09-20", "2026-09-27", "2026-10-04"].map((heldOn) => ({ classId: b.classId, termId: b.termId, heldOn }))).returning();
    await db.insert(attendance).values([
      ...old.map((o) => ({ sessionId: o.id, studentId: an.id, status: "absent_unexcused" as const })),
      ...old.map((o) => ({ sessionId: o.id, studentId: binh.id, status: "present" as const })),
    ]);
    return { ...s, old };
  }

  const CURRENT = "2026-10-12"; // trong học kỳ của seedBasics (01/09/2026 – 15/01/2027)
  const LATER = "2027-03-01"; // học kỳ đó đã qua

  it("current term: old sessions keep their rows; the old class's stats and attention list follow the current class", async () => {
    const { db, b, cls2, glv2, an, binh, chi, old, apply } = await withHistory();
    const statsBefore = await classStats(db, b.glv, b.classId, b.termId, CURRENT);
    expect(statsBefore?.rows.map((r) => r.fullName)).toEqual(["An", "Bình", "Chi"]);
    expect((await attentionList(db, b.glv, b.termId, CURRENT)).map((a) => a.fullName)).toEqual(["An"]);
    await apply(b.head, [an.id, binh.id]);
    const stats = await classStats(db, b.glv, b.classId, b.termId, CURRENT);
    expect(stats?.rows.map((r) => r.studentId)).toEqual([chi.id]);
    expect(await attentionList(db, b.glv, b.termId, CURRENT)).toEqual([]);
    const fresh = await classStats(db, glv2, cls2.id, b.termId, CURRENT);
    expect(fresh?.rows.map((r) => [r.fullName, r.summary.marked, r.former])).toEqual([["An", 0, false], ["Bình", 0, false]]);
    const rows = await db.select().from(attendance).where(inArray(attendance.sessionId, old.map((o) => o.id)));
    expect(rows).toHaveLength(6);
  });

  it("past term: the old class keeps its promoted students with their rows (marked as moved), nobody else is added", async () => {
    const { db, b, cls2, glv2, an, binh, apply, kid } = await withHistory();
    const stranger = await kid("Người Lạ", {}, b.otherClassId); // lớp khác, không có dòng ở lớp A
    await apply(b.head, [an.id, binh.id]);
    const stats = await classStats(db, b.glv, b.classId, b.termId, LATER);
    expect(stats?.rows.map((r) => [r.fullName, r.summary.marked, r.summary.unexcused, r.former])).toEqual([
      ["An", 3, 3, true], ["Bình", 3, 0, true], ["Chi", 0, 0, false],
    ]);
    expect(JSON.stringify(stats)).not.toContain(an.qrToken);
    expect(JSON.stringify(stats)).not.toContain(stranger.id);
    // Danh sách cần hành động không bao giờ có em đã lên lớp khác (vẫn có trong thống kê với nhãn).
    expect(await attentionList(db, b.glv, b.termId, LATER)).toEqual([]);
    const overview = await gradeOverview(db, b.head, b.termId, LATER);
    expect(overview?.find((r) => r.classId === b.classId)).toMatchObject({ studentCount: 3, sessions: 3, warningCount: 1 });
    // Lớp mới, học kỳ cũ: các em được chuyển vào SAU (đã có dòng ở lớp khác trong học kỳ đó) không phải thành viên.
    expect(overview?.find((r) => r.classId === cls2.id)).toMatchObject({ studentCount: 0, sessions: 0, warningCount: 0 });
    const newer = await classStats(db, glv2, cls2.id, b.termId, LATER);
    expect(newer?.rows).toEqual([]);
  });

  it("past term of the destination class: a member never marked that term stays; a promoted-in pupil marked elsewhere does not", async () => {
    const { db, b, cls2, glv2, an, apply, kid } = await withHistory();
    const quiet = await kid("Dung", {}, cls2.id); // thành viên A2 từ đầu, chưa từng được điểm danh trong học kỳ
    const [s2] = await db.insert(sessions).values({ classId: cls2.id, termId: b.termId, heldOn: "2026-10-04" }).returning();
    const regular = await kid("Đạt", {}, cls2.id);
    await db.insert(attendance).values({ sessionId: s2.id, studentId: regular.id, status: "present" });
    await apply(b.head, [an.id]);
    const past = await classStats(db, glv2, cls2.id, b.termId, LATER);
    expect(past?.rows.map((r) => [r.fullName, r.former])).toEqual([["Dung", false], ["Đạt", false]]);
    expect(JSON.stringify(past)).not.toContain(an.id);
    expect(past?.rows.map((r) => r.studentId)).toContain(quiet.id);
    // Học kỳ hiện tại giữ nguyên: mọi thành viên hiện tại.
    const now = await classStats(db, glv2, cls2.id, b.termId, CURRENT);
    expect(now?.rows.map((r) => r.fullName)).toEqual(["An", "Dung", "Đạt"]);
    // Lớp nguồn vẫn liệt kê An với nhãn.
    const source = await classStats(db, b.glv, b.classId, b.termId, LATER);
    expect(source?.rows.find((r) => r.studentId === an.id)?.former).toBe(true);
  });

  it("past term of the destination class: mass stats follow the same roster rule (parity with class stats)", async () => {
    const { db, b, cls2, glv2, an, binh, apply, kid } = await withHistory();
    const [m1] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-04", kind: "mass" }).returning();
    await db.insert(attendance).values({ sessionId: m1.id, studentId: an.id, status: "present" });
    const [m2] = await db.insert(sessions).values({ classId: cls2.id, termId: b.termId, heldOn: "2026-10-04", kind: "mass" }).returning();
    const member = await kid("Dung", {}, cls2.id);
    await db.insert(attendance).values({ sessionId: m2.id, studentId: member.id, status: "present" });
    await apply(b.head, [an.id, binh.id]);
    const mass = await massStats(db, glv2, { classId: cls2.id, termId: b.termId, today: LATER });
    const stats = await classStats(db, glv2, cls2.id, b.termId, LATER);
    expect(mass?.rows.map((r) => r.fullName)).toEqual(["Dung"]);
    expect(mass?.rows.map((r) => r.fullName)).toEqual(stats?.rows.map((r) => r.fullName));
    const current = await massStats(db, glv2, { classId: cls2.id, termId: b.termId, today: CURRENT });
    expect(current?.rows.map((r) => r.fullName)).toEqual(["An", "Bình", "Dung"]);
  });

  it("past term of the destination class: the printable term report and the grade report inherit the rule", async () => {
    const { db, b, cls2, glv2, an, binh, apply } = await withHistory();
    await apply(b.head, [an.id, binh.id]);
    const report = await classTermReport(db, glv2, cls2.id, b.termId, LATER);
    expect(report).not.toBeNull();
    expect(JSON.stringify(report)).not.toContain(an.id);
    expect(JSON.stringify(report)).not.toContain(binh.id);
    const grade = await gradeReport(db, b.head, b.termId, LATER);
    expect(grade?.classes.find((c) => c.classId === cls2.id)).toMatchObject({ studentCount: 0, sessions: 0, unexcusedWarnings: 0, massWarnings: 0 });
  });

  it("past term: mass stats of the old class keep promoted students and their weeks", async () => {
    const { db, b, an, apply } = await withHistory();
    const [mass] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-04", kind: "mass" }).returning();
    await db.insert(attendance).values({ sessionId: mass.id, studentId: an.id, status: "present" });
    await apply(b.head, [an.id]);
    const current = await massStats(db, b.glv, { classId: b.classId, termId: b.termId, today: CURRENT });
    expect(current?.rows.map((r) => r.fullName)).toEqual(["Bình", "Chi"]);
    const past = await massStats(db, b.glv, { classId: b.classId, termId: b.termId, today: LATER });
    expect(past?.rows.map((r) => [r.fullName, r.attendedWeeks, r.former])).toEqual([["An", 1, true], ["Bình", 0, false], ["Chi", 0, false]]);
  });

  it("the profile in the new class still shows the attendance history from the old class", async () => {
    const { db, b, cls2, glv2, an, apply } = await withHistory();
    await apply(b.head, [an.id]);
    const p = await getStudentProfile(db, glv2, { classId: cls2.id, studentId: an.id, today: "2026-10-12" });
    expect(p?.records.map((r) => r.heldOn)).toEqual(["2026-10-04", "2026-09-27", "2026-09-20"]);
    expect(p?.summary.unexcused).toBe(3);
    // Hồ sơ theo đường dẫn lớp cũ không còn mở được (em không thuộc lớp đó nữa).
    expect(await getStudentProfile(db, b.glv, { classId: b.classId, studentId: an.id, today: "2026-10-12" })).toBeNull();
  });

  it("the same card is refused in the old class's session and works in the new class's session", async () => {
    const { db, b, cls2, glv2, an, apply } = await setup();
    const [oldS] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
    const [newS] = await db.insert(sessions).values({ classId: cls2.id, termId: b.termId, heldOn: "2026-10-11" }).returning();
    await apply(b.head, [an.id]);
    const scan = (user: typeof b.glv, sessionId: string) =>
      applyScan(db, user, { eventId: crypto.randomUUID(), sessionId, kind: "scan", token: an.qrToken, mode: "present" });
    expect(await scan(b.glv, oldS.id)).toMatchObject({ ok: false, code: "invalid_card" });
    expect(await scan(glv2, newS.id)).toMatchObject({ ok: true, data: { result: "applied", studentId: an.id, status: "present" } });
  });
});

describe("past term after promotions: one labelling rule, attention lists stay actionable", () => {
  const LATER = "2027-03-01"; // hè: không học kỳ nào chứa ngày => resolveTerm trả học kỳ vừa kết thúc

  async function scenario() {
    const s = await setup();
    const { db, b, cls2, an, binh, nghi } = s;
    const [cls3] = await db.insert(classes).values({ gradeId: b.gradeId, name: "Lớp A3" }).returning();
    const old = await db.insert(sessions).values(["2026-09-20", "2026-09-27", "2026-10-04"].map((heldOn) => ({ classId: b.classId, termId: b.termId, heldOn }))).returning();
    const [mass] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-04", kind: "mass" }).returning();
    await db.insert(attendance).values([
      ...old.map((o) => ({ sessionId: o.id, studentId: an.id, status: "absent_unexcused" as const })),
      ...old.map((o) => ({ sessionId: o.id, studentId: binh.id, status: "present" as const })),
      ...old.map((o) => ({ sessionId: o.id, studentId: nghi.id, status: "absent_unexcused" as const })), // đã nghỉ, vẫn ở lớp A
      { sessionId: mass.id, studentId: an.id, status: "present" as const },
      { sessionId: mass.id, studentId: nghi.id, status: "absent_unexcused" as const },
    ]);
    await s.apply(b.head, [an.id, binh.id]); // An, Bình: A -> A2
    const [s2] = await db.insert(sessions).values({ classId: cls2.id, termId: b.termId, heldOn: "2026-10-11" }).returning();
    await db.insert(attendance).values({ sessionId: s2.id, studentId: binh.id, status: "absent_unexcused" });
    await applyPromotion(db, b.head, { fromClassId: cls2.id, toClassId: cls3.id, studentIds: [binh.id] }); // Bình chuyển lần hai: A2 -> A3
    await db.update(grades).set({ massThreshold: 1 }).where(eq(grades.id, b.gradeId));
    return { ...s, cls3 };
  }
  const labels = (rows: { fullName: string; former: boolean; inactive: boolean }[] | undefined) =>
    rows?.map((r) => [r.fullName, r.former, r.inactive]);

  it("labels former only when the current class differs from the class that held the session (class sheet = mass sheet)", async () => {
    const { db, b, cls2 } = await scenario();
    const term = await resolveTerm(db, undefined, LATER);
    expect(term?.id).toBe(b.termId);
    const stats = await classStats(db, b.head, b.classId, b.termId, LATER);
    expect(labels(stats?.rows)).toEqual([["An", true, false], ["Bình", true, false], ["Chi", false, false], ["Nghỉ", false, true]]);
    const mass = await massStats(db, b.head, { classId: b.classId, termId: b.termId, today: LATER });
    expect(labels(mass?.rows)).toEqual(labels(stats?.rows));
    // Lớp A2: Bình (đã chuyển tiếp sang A3) mang nhãn ở A2; An (chuyển vào A2 sau, có dòng ở lớp A trong học kỳ) không
    // thuộc số liệu học kỳ cũ của A2.
    const a2 = await classStats(db, b.head, cls2.id, b.termId, LATER);
    expect(a2?.rows.map((r) => [r.fullName, r.former, r.summary.marked])).toEqual([["Bình", true, 1]]);
    const overview = await gradeOverview(db, b.head, b.termId, LATER);
    expect(overview?.find((r) => r.classId === b.classId)?.studentCount).toBe(4);
    expect(overview?.find((r) => r.classId === cls2.id)?.studentCount).toBe(1);
  });

  it("attention lists (home, Cần chú ý) never list former or inactive students, even in the summer-gap default term", async () => {
    const { db, b, glv2 } = await scenario();
    const term = await resolveTerm(db, undefined, LATER);
    for (const user of [b.head, b.glv, glv2]) {
      expect(await attentionList(db, user, term!.id, LATER)).toEqual([]);
      expect(await massAttentionList(db, user, term!.id, LATER)).toEqual([]);
    }
  });
});

describe("undoPromotion", () => {
  async function promoted() {
    const s = await setup();
    const r = await s.apply(s.b.head, [s.an.id, s.binh.id]);
    if (!r.ok || !r.data.promotionId) throw new Error("setup failed");
    return { ...s, promotionId: r.data.promotionId };
  }

  it("moves the students back within 24 hours and writes one audit row per class; a second undo is refused", async () => {
    const { db, b, cls2, an, binh, classOf, promotionId } = await promoted();
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: true, data: { restored: 2, notRestored: 0 } });
    expect([await classOf(an.id), await classOf(binh.id)]).toEqual([b.classId, b.classId]);
    const [promo] = await db.select().from(promotions);
    expect(promo.undoneAt).not.toBeNull();
    expect(promo.undoneBy).toBe(b.head.id);
    const undos = (await auditRows(db)).filter((a) => a.action === "promotion.undo");
    expect(undos).toHaveLength(2);
    expect(undos.find((a) => a.classId === b.classId)).toMatchObject({ gradeId: b.gradeId, entity: "promotion", entityId: promotionId,
      summary: { fromClass: "Lớp A", toClass: "Lớp A2", restored: 2, notRestored: 0 } });
    expect(undos.find((a) => a.classId === cls2.id)).toMatchObject({ summary: { fromClass: "Lớp A", toClass: "Lớp A2", restored: 2, notRestored: 0, direction: "in" } });
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: false, error: "Lượt lên lớp này đã được hoàn tác" });
    expect(await auditRows(db)).toHaveLength(4);
  });

  it("is refused after 24 hours", async () => {
    const { db, b, an, classOf, promotionId } = await promoted();
    await db.execute(sql`update promotions set created_at = now() - interval '24 hours 1 minute'`);
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: false, error: "Đã quá 24 giờ, không hoàn tác được nữa" });
    expect(await classOf(an.id)).not.toBe(b.classId);
  });

  it("is allowed for another head of the same grade, refused for catechists and other grades' heads", async () => {
    const { db, b, glv2, otherHead, head2, promotionId } = await promoted();
    const missing = { ok: false, error: "Không tìm thấy lượt lên lớp" };
    expect(await undoPromotion(db, b.glv, { promotionId })).toEqual(missing);
    expect(await undoPromotion(db, glv2, { promotionId })).toEqual(missing);
    expect(await undoPromotion(db, otherHead, { promotionId })).toEqual(missing);
    expect(await undoPromotion(db, b.head, { promotionId: crypto.randomUUID() })).toEqual(missing);
    expect(await undoPromotion(db, b.head, { promotionId: "nope" })).toEqual(missing);
    expect(await undoPromotion(db, head2, { promotionId })).toMatchObject({ ok: true, data: { restored: 2 } });
  });

  it("only moves back students still in the target class and reports the others; new-class seats are cleared", async () => {
    const { db, b, cls2, an, binh, classOf, promotionId } = await promoted();
    await db.update(students).set({ classId: b.otherClassId }).where(eq(students.id, binh.id)); // chuyển tiếp nơi khác
    const [plan] = await db.insert(seatingPlans).values({ classId: cls2.id, name: "Sơ đồ mới", layout: [{ id: "r", items: [{ type: "bench", id: "b1", seats: 2 }] }] }).returning();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: an.id });
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: true, data: { restored: 1, notRestored: 1 } });
    expect([await classOf(an.id), await classOf(binh.id)]).toEqual([b.classId, b.otherClassId]);
    expect(await db.select().from(seatAssignments).where(eq(seatAssignments.planId, plan.id))).toEqual([]);
  });
});

describe("undoPromotion: a later promotion of the same students", () => {
  it("is refused while a newer, not undone promotion includes any of the students; allowed once that one is undone", async () => {
    const { db, b, cls2, an, binh, apply, classOf } = await setup();
    const first = await apply(b.head, [an.id, binh.id]);
    const firstId = first.ok ? first.data.promotionId ?? "" : "";
    const second = await applyPromotion(db, b.head, { fromClassId: cls2.id, toClassId: b.classId, studentIds: [an.id] });
    const secondId = second.ok ? second.data.promotionId ?? "" : "";
    expect(await undoPromotion(db, b.head, { promotionId: firstId })).toEqual({
      ok: false, error: "Có em trong lượt này đã được chuyển tiếp ở một lượt lên lớp sau. Hãy hoàn tác lượt sau trước.",
    });
    expect(await undoPromotion(db, b.head, { promotionId: secondId })).toMatchObject({ ok: true, data: { restored: 1 } });
    expect(await undoPromotion(db, b.head, { promotionId: firstId })).toEqual({ ok: true, data: { restored: 2, notRestored: 0 } });
    expect([await classOf(an.id), await classOf(binh.id)]).toEqual([b.classId, b.classId]);
  });
});

describe("cross-grade visibility", () => {
  it("the target grade's head sees incoming promotions read-only and a 7-day banner; the source head can undo", async () => {
    const { db, b, an, otherHead, setNext } = await setup();
    await setNext(b.otherGradeId);
    const r = await applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: b.otherClassId, studentIds: [an.id] });
    expect(r.ok).toBe(true);
    const mine = await listPromotions(db, b.head);
    expect(mine?.map((p) => [p.fromClassName, p.toClassName, p.incoming, p.canUndo])).toEqual([["Lớp A", "Lớp B", false, true]]);
    const theirs = await listPromotions(db, otherHead);
    expect(theirs?.map((p) => [p.fromClassName, p.toClassName, p.incoming, p.canUndo])).toEqual([["Lớp A", "Lớp B", true, false]]);
    const notices = await incomingNotices(db, otherHead);
    expect(notices?.transfers.map((t) => [t.fromGradeName, t.fromClassName, t.toClassName, t.count, t.undone])).toEqual([["Khối 1", "Lớp A", "Lớp B", 1, false]]);
    expect(await incomingNotices(db, b.head)).toEqual({ transfers: [], links: [] });
    expect(await incomingNotices(db, b.glv)).toBeNull();
    await db.execute(sql`update promotions set created_at = now() - interval '8 days'`);
    expect((await incomingNotices(db, otherHead))?.transfers).toEqual([]);
  });

  it("the banner shows when another grade names this grade as its next grade", async () => {
    const { db, b, otherHead } = await setup();
    await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.otherGradeId });
    const notices = await incomingNotices(db, otherHead);
    expect(notices?.links.map((l) => l.text)).toEqual(["head@x.vn đặt khối kế tiếp của Khối 1: chưa có → Khối 2"]);
    expect((await incomingNotices(db, b.head))?.links).toEqual([]);
  });
});

describe("rollback when the audit insert fails", () => {
  it("apply leaves students, seats and promotions untouched", async () => {
    const { db, b, an, binh, apply } = await setup();
    const layout = [{ id: "r1", items: [{ type: "bench" as const, id: "b1", seats: 2 }] }];
    const [plan] = await db.insert(seatingPlans).values({ classId: b.classId, name: "S", layout, isActive: true }).returning();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: an.id });
    const before = await dataSnapshot(db);
    await breakAuditInserts(db);
    await expect(apply(b.head, [an.id, binh.id])).rejects.toThrow();
    expect(await dataSnapshot(db)).toEqual(before);
    expect(await db.select().from(promotions)).toHaveLength(0);
  });

  it("undo leaves the promotion open and students in the target", async () => {
    const { db, b, cls2, an, apply, classOf } = await setup();
    const r = await apply(b.head, [an.id]);
    const promotionId = r.ok ? r.data.promotionId ?? "" : "";
    await breakAuditInserts(db);
    await expect(undoPromotion(db, b.head, { promotionId })).rejects.toThrow();
    expect(await classOf(an.id)).toBe(cls2.id);
    expect((await db.select().from(promotions))[0].undoneAt).toBeNull();
  });
});

describe("listPromotions", () => {
  it("lists the grade's promotions newest first with status and whether undo is still possible", async () => {
    const { db, b, an, binh, apply, otherHead } = await setup();
    const first = await apply(b.head, [an.id]);
    await db.execute(sql`update promotions set created_at = now() - interval '2 days'`);
    await apply(b.head, [binh.id]);
    const firstId = first.ok ? first.data.promotionId : null;
    expect(await listPromotions(db, b.glv)).toBeNull();
    expect(await listPromotions(db, otherHead)).toEqual([]);
    const list = await listPromotions(db, b.head);
    expect(list?.map((p) => [p.fromClassName, p.toClassName, p.count, p.canUndo, p.undone])).toEqual([
      ["Lớp A", "Lớp A2", 1, true, false],
      ["Lớp A", "Lớp A2", 1, false, false],
    ]);
    expect(list?.[1].id).toBe(firstId);
    expect(list?.[0].actorName).toBe("head@x.vn");
    const done = await undoPromotion(db, b.head, { promotionId: list?.[0].id ?? "" });
    expect(done.ok).toBe(true);
    expect((await listPromotions(db, b.head))?.[0]).toMatchObject({ undone: true, canUndo: false });
    // không có cột nào của em (mã thẻ) trong danh sách
    expect(JSON.stringify(await listPromotions(db, b.head))).not.toContain(an.qrToken);
  });
});
