import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendance, classCatechists, classes, grades, promotions, seatAssignments, seatingPlans, sessions, students, users } from "@/db/schema";
import { auditRows, breakAuditInserts, dataSnapshot } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { applyPromotion, listPromotions, previewPromotion, promotionTargets, undoPromotion } from "./promotions";
import { applyScan } from "./scan";
import { attentionList, classStats } from "./stats";
import { getStudentProfile } from "./student-profile";

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
    const audit = await auditRows(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: b.head.id, classId: b.classId, gradeId: b.gradeId, entity: "promotion", entityId: promo.id, action: "promotion.apply",
      summary: { fromClass: "Lớp A", toClass: "Lớp A2", count: 2, skipped: 0, seatsRemoved: 0 },
    });
    expect(JSON.stringify(audit[0].summary)).not.toContain(an.qrToken);
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
    expect(await auditRows(db)).toHaveLength(1);
  });

  it("without a token, students already in the target are skipped; nothing left to move writes nothing", async () => {
    const { db, b, an, binh, apply } = await setup();
    await apply(b.head, [an.id]);
    expect(await apply(b.head, [an.id, binh.id])).toMatchObject({ ok: true, data: { moved: 1, skipped: 1 } });
    expect(await apply(b.head, [an.id, binh.id])).toEqual({ ok: true, data: { promotionId: null, moved: 0, skipped: 2, seatsRemoved: 0 } });
    expect(await db.select().from(promotions)).toHaveLength(2);
    expect((await auditRows(db)).map((r) => r.summary)).toEqual([
      { fromClass: "Lớp A", toClass: "Lớp A2", count: 1, skipped: 0, seatsRemoved: 0 },
      { fromClass: "Lớp A", toClass: "Lớp A2", count: 1, skipped: 1, seatsRemoved: 0 },
    ]);
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

  it("old sessions keep their rows; the old class's stats and attention list no longer include moved students", async () => {
    const { db, b, an, binh, chi, old, apply } = await withHistory();
    const statsBefore = await classStats(db, b.glv, b.classId, b.termId);
    expect(statsBefore?.rows.map((r) => r.fullName)).toEqual(["An", "Bình", "Chi"]);
    expect((await attentionList(db, b.glv, b.termId)).map((a) => a.fullName)).toEqual(["An"]);
    await apply(b.head, [an.id, binh.id]);
    const stats = await classStats(db, b.glv, b.classId, b.termId);
    expect(stats?.rows.map((r) => r.studentId)).toEqual([chi.id]);
    expect(await attentionList(db, b.glv, b.termId)).toEqual([]);
    const rows = await db.select().from(attendance).where(inArray(attendance.sessionId, old.map((o) => o.id)));
    expect(rows).toHaveLength(6);
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

describe("undoPromotion", () => {
  async function promoted() {
    const s = await setup();
    const r = await s.apply(s.b.head, [s.an.id, s.binh.id]);
    if (!r.ok || !r.data.promotionId) throw new Error("setup failed");
    return { ...s, promotionId: r.data.promotionId };
  }

  it("moves the students back within 24 hours and writes one audit row; a second undo is refused", async () => {
    const { db, b, an, binh, classOf, promotionId } = await promoted();
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: true, data: { restored: 2, notRestored: 0 } });
    expect([await classOf(an.id), await classOf(binh.id)]).toEqual([b.classId, b.classId]);
    const [promo] = await db.select().from(promotions);
    expect(promo.undoneAt).not.toBeNull();
    expect(promo.undoneBy).toBe(b.head.id);
    const audit = await auditRows(db);
    expect(audit.map((a) => a.action)).toEqual(["promotion.apply", "promotion.undo"]);
    expect(audit[1]).toMatchObject({ classId: b.classId, gradeId: b.gradeId, entity: "promotion", entityId: promotionId,
      summary: { fromClass: "Lớp A", toClass: "Lớp A2", restored: 2, notRestored: 0 } });
    expect(await undoPromotion(db, b.head, { promotionId })).toEqual({ ok: false, error: "Lượt lên lớp này đã được hoàn tác" });
    expect(await auditRows(db)).toHaveLength(2);
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
