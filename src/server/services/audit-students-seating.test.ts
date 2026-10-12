import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getPlan } from "@/db/queries/seating";
import { students } from "@/db/schema";
import type { BenchItem } from "@/lib/seating/types";
import { auditRows, breakAuditInserts, dataSnapshot } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { markAllPresent, markRemainingAbsent, openSession, setStatus } from "./attendance";
import { setMassThreshold } from "./grade-settings";
import { rotateQrToken } from "./qr-cards";
import { activatePlan, applyTemplate, assignSeat, createPlan, deletePlan, saveLayout } from "./seating";
import { addStudent, importStudents, setStudentActive, updateStudent, updateStudentContact } from "./students";

const LATE_NOW = new Date("2027-02-01T05:00:00Z");
const PHONE = "0901234567";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName, ...extra }).returning())[0];
  return { db, b, kid };
}

describe("student actions", () => {
  it("student.create: one row with the new id and the name, never the phone", async () => {
    const { db, b } = await setup();
    const r = await addStudent(db, b.glv, { classId: b.classId, fullName: "An", parentPhone: PHONE });
    if (!r.ok) throw new Error(r.error);
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: b.glv.id, classId: b.classId, entity: "student", entityId: r.data.id, action: "student.create", summary: { studentName: "An" } });
  });

  it("student.update: changed fields, names before/after and the phone only masked; nothing when nothing changed", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An", { parentPhone: PHONE, note: "ghi chú" });
    await updateStudent(db, b.glv, { studentId: an.id, fullName: "An Nguyễn", parentPhone: "0912345678", note: "ghi chú" });
    await updateStudent(db, b.glv, { studentId: an.id, fullName: "An Nguyễn", parentPhone: "0912 345 678", note: "ghi chú" });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: "student", entityId: an.id, action: "student.update",
      summary: {
        studentName: "An Nguyễn", changed: ["fullName", "parentPhone"],
        before: { fullName: "An", parentPhone: "••••••567" }, after: { fullName: "An Nguyễn", parentPhone: "••••••678" },
      },
    });
  });

  it("student.contact_update: masked phones and a note flag, never the note text; nothing when unchanged", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    await updateStudentContact(db, b.glv, { studentId: an.id, parentPhone: PHONE, note: "dị ứng" });
    await updateStudentContact(db, b.glv, { studentId: an.id, parentPhone: PHONE, note: "dị ứng" });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "student.contact_update", entityId: an.id,
      summary: { studentName: "An", changed: ["parentPhone", "note"], before: { parentPhone: null }, after: { parentPhone: "••••••567" } },
    });
    expect(JSON.stringify(rows[0].summary)).not.toContain("dị ứng");
  });

  it("student.deactivate / student.reactivate only on a real change", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    await setStudentActive(db, b.glv, { studentId: an.id, active: true });
    await setStudentActive(db, b.glv, { studentId: an.id, active: false });
    await setStudentActive(db, b.glv, { studentId: an.id, active: false });
    await setStudentActive(db, b.glv, { studentId: an.id, active: true });
    expect((await auditRows(db)).map((r) => [r.action, r.entityId, r.summary.studentName])).toEqual([
      ["student.deactivate", an.id, "An"], ["student.reactivate", an.id, "An"],
    ]);
  });

  it("student.import: one row with the counts; none when every row was skipped", async () => {
    const { db, b } = await setup();
    const rows = [{ fullName: "An", parentPhone: PHONE }, { fullName: "Bình" }];
    await importStudents(db, b.glv, { classId: b.classId, rows });
    await importStudents(db, b.glv, { classId: b.classId, rows });
    const audit = await auditRows(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "student.import", classId: b.classId, entityId: null, summary: { count: 2, skipped: 0 } });
  });

  it("student.qr_rotate: the name only, no token values", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    await rotateQrToken(db, b.glv, { studentId: an.id });
    const [after] = await db.select({ t: students.qrToken }).from(students).where(eq(students.id, an.id));
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "student.qr_rotate", entityId: an.id, summary: { studentName: "An" } });
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(an.qrToken);
    expect(dump).not.toContain(after.t);
  });

  it("refused student actions write nothing", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    expect((await addStudent(db, b.head, { classId: b.classId, fullName: "X" })).ok).toBe(false);
    expect((await updateStudent(db, b.otherGlv, { studentId: an.id, fullName: "X" })).ok).toBe(false);
    expect((await updateStudentContact(db, b.head, { studentId: an.id, parentPhone: PHONE })).ok).toBe(false);
    expect((await setStudentActive(db, b.head, { studentId: an.id, active: false })).ok).toBe(false);
    expect((await importStudents(db, b.otherGlv, { classId: b.classId, rows: [{ fullName: "X" }] })).ok).toBe(false);
    expect((await rotateQrToken(db, b.head, { studentId: an.id })).ok).toBe(false);
    expect((await addStudent(db, b.glv, { classId: b.classId, fullName: "  " })).ok).toBe(false);
    expect(await auditRows(db)).toHaveLength(0);
  });
});

describe("seating plan actions", () => {
  it("create / apply_template / save_layout / activate / delete: one row each with the plan name; seat taps are not audited", async () => {
    const { db, b, kid } = await setup();
    const first = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 1" });
    const second = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 2", templateId: "vua-3-day" });
    if (!first.ok || !second.ok) throw new Error("setup");
    await applyTemplate(db, b.glv, { planId: second.data.id, templateId: "lop-nho-2-day" });
    const plan = await getPlan(db, second.data.id);
    const bench = plan!.plan.layout.flatMap((r) => r.items).find((i): i is BenchItem => i.type === "bench")!;
    const an = await kid("An");
    await assignSeat(db, b.glv, { planId: second.data.id, benchId: bench.id, seatIndex: 0, studentId: an.id });
    await saveLayout(db, b.glv, { planId: second.data.id, layout: plan!.plan.layout }); // giống hệt: không đổi gì
    const trimmed = plan!.plan.layout.slice(1);
    await saveLayout(db, b.glv, { planId: second.data.id, layout: trimmed });
    await activatePlan(db, b.glv, { planId: second.data.id });
    await activatePlan(db, b.glv, { planId: second.data.id }); // đã đang dùng
    await deletePlan(db, b.glv, { planId: first.data.id });
    const rows = await auditRows(db);
    expect(rows.map((r) => [r.action, r.entityId])).toEqual([
      ["seating.create", first.data.id], ["seating.create", second.data.id],
      ["seating.apply_template", second.data.id], ["seating.save_layout", second.data.id],
      ["seating.activate", second.data.id], ["seating.delete", first.data.id],
    ]);
    expect(rows[0].summary).toEqual({ planName: "Sơ đồ 1", templateId: null, active: true });
    expect(rows[1].summary).toEqual({ planName: "Sơ đồ 2", templateId: "vua-3-day", active: false });
    expect(rows[2].summary).toEqual({ planName: "Sơ đồ 2", templateId: "lop-nho-2-day" });
    expect(rows[3].summary).toMatchObject({ planName: "Sơ đồ 2", seatsKept: expect.any(Number), seatsRemoved: expect.any(Number) });
    expect(rows[4].summary).toEqual({ planName: "Sơ đồ 2" });
    expect(rows[5].summary).toEqual({ planName: "Sơ đồ 1" });
    for (const r of rows) expect(r).toMatchObject({ entity: "seating_plan", classId: b.classId, actorId: b.glv.id });
  });

  it("free-text plan names with long digit runs are masked, not rejected", async () => {
    const { db, b } = await setup();
    expect((await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 0901 234 567" })).ok).toBe(true);
    expect((await auditRows(db))[0].summary).toMatchObject({ planName: "Sơ đồ ••••••567" });
  });

  it("refused seating actions write nothing", async () => {
    const { db, b } = await setup();
    const created = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 1" });
    if (!created.ok) throw new Error("setup");
    const planId = created.data.id;
    expect((await createPlan(db, b.head, { classId: b.classId, name: "X" })).ok).toBe(false);
    expect((await applyTemplate(db, b.otherGlv, { planId, templateId: "vua-3-day" })).ok).toBe(false);
    expect((await applyTemplate(db, b.glv, { planId, templateId: "nope" })).ok).toBe(false);
    expect((await activatePlan(db, b.head, { planId })).ok).toBe(false);
    expect((await deletePlan(db, b.glv, { planId })).ok).toBe(false); // đang dùng
    expect((await auditRows(db)).map((r) => r.action)).toEqual(["seating.create"]);
  });
});

describe("grade.mass_threshold", () => {
  it("records the grade (no class) with before/after; nothing for the same value or another grade's head", async () => {
    const { db, b } = await setup();
    await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold: 2 });
    await setMassThreshold(db, b.head, { gradeId: b.gradeId, threshold: 4 });
    await setMassThreshold(db, b.head, { gradeId: b.otherGradeId, threshold: 5 });
    await setMassThreshold(db, b.glv, { gradeId: b.gradeId, threshold: 5 });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: b.head.id, classId: null, gradeId: b.gradeId, entity: "grade_settings", entityId: b.gradeId, action: "grade.mass_threshold",
      summary: { gradeName: "Khối 1", before: 2, after: 4 },
    });
  });
});

describe("rollback: a failing audit insert leaves no change and no row", () => {
  type S = Awaited<ReturnType<typeof setup>>;
  const withKid = async (s: S) => s.kid("An", { parentPhone: PHONE });
  const withPlans = async (s: S) => {
    const a = await createPlan(s.db, s.b.glv, { classId: s.b.classId, name: "A" });
    const b2 = await createPlan(s.db, s.b.glv, { classId: s.b.classId, name: "B" });
    if (!a.ok || !b2.ok) throw new Error("setup");
    return { active: a.data.id, inactive: b2.data.id };
  };
  const cases: [string, (s: S) => Promise<() => Promise<unknown>>][] = [
    ["addStudent", async (s) => () => addStudent(s.db, s.b.glv, { classId: s.b.classId, fullName: "An" })],
    ["updateStudent", async (s) => { const an = await withKid(s); return () => updateStudent(s.db, s.b.glv, { studentId: an.id, fullName: "Khác" }); }],
    ["updateStudentContact", async (s) => { const an = await withKid(s); return () => updateStudentContact(s.db, s.b.glv, { studentId: an.id, parentPhone: "0912345678" }); }],
    ["setStudentActive", async (s) => { const an = await withKid(s); return () => setStudentActive(s.db, s.b.glv, { studentId: an.id, active: false }); }],
    ["importStudents", async (s) => () => importStudents(s.db, s.b.glv, { classId: s.b.classId, rows: [{ fullName: "An" }] })],
    ["rotateQrToken", async (s) => { const an = await withKid(s); return () => rotateQrToken(s.db, s.b.glv, { studentId: an.id }); }],
    ["createPlan", async (s) => () => createPlan(s.db, s.b.glv, { classId: s.b.classId, name: "A" })],
    ["applyTemplate", async (s) => { const p = await withPlans(s); return () => applyTemplate(s.db, s.b.glv, { planId: p.inactive, templateId: "vua-3-day" }); }],
    ["saveLayout", async (s) => {
      const p = await withPlans(s);
      const plan = await getPlan(s.db, p.inactive);
      return () => saveLayout(s.db, s.b.glv, { planId: p.inactive, layout: plan!.plan.layout.slice(1) });
    }],
    ["activatePlan", async (s) => { const p = await withPlans(s); return () => activatePlan(s.db, s.b.glv, { planId: p.inactive }); }],
    ["deletePlan", async (s) => { const p = await withPlans(s); return () => deletePlan(s.db, s.b.glv, { planId: p.inactive }); }],
    ["setMassThreshold", async (s) => () => setMassThreshold(s.db, s.b.head, { gradeId: s.b.gradeId, threshold: 5 })],
  ];
  it.each(cases)("%s", async (_name, prepare) => {
    const s = await setup();
    const run = await prepare(s);
    const before = await dataSnapshot(s.db);
    const auditBefore = (await auditRows(s.db)).length;
    await breakAuditInserts(s.db);
    await expect(run()).rejects.toThrow();
    expect(await dataSnapshot(s.db)).toEqual(before);
    expect(await auditRows(s.db)).toHaveLength(auditBefore);
  });
});

describe("no card token, card payload or full phone ever reaches the audit log", () => {
  it("across every audited action on a student with a phone and a QR token", async () => {
    const { db, b, kid } = await setup();
    const phones = ["0901234567", "+84 912 345 678", "0987.654.321"];
    const an = await kid("An", { parentPhone: phones[0] });
    const tokens = [an.qrToken];
    const sessionId = await (async () => {
      const r = await openSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-10" }, LATE_NOW);
      if (!r.ok) throw new Error(r.error);
      return r.data.id;
    })();
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_excused", reason: `${phones[1]} dd1.${an.qrToken}` });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: "absent_unexcused", reason: an.qrToken });
    await setStatus(db, b.glv, { sessionId, studentId: an.id, status: null, reason: null });
    await markAllPresent(db, b.glv, { sessionId });
    await markRemainingAbsent(db, b.glv, { sessionId });
    await updateStudent(db, b.glv, { studentId: an.id, fullName: "An", parentPhone: phones[1], note: `gọi ${phones[2]}` });
    await updateStudentContact(db, b.glv, { studentId: an.id, parentPhone: phones[2], note: an.qrToken });
    await rotateQrToken(db, b.glv, { studentId: an.id });
    tokens.push((await db.select({ t: students.qrToken }).from(students).where(eq(students.id, an.id)))[0].t);
    await addStudent(db, b.glv, { classId: b.classId, fullName: "Bình", parentPhone: phones[1], note: phones[0] });
    await importStudents(db, b.glv, { classId: b.classId, rows: [{ fullName: "Chi", parentPhone: phones[2], note: phones[1] }] });
    await setStudentActive(db, b.glv, { studentId: an.id, active: false });

    const rows = await auditRows(db);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    const dump = JSON.stringify(rows);
    const digitsOnly = dump.replace(/\D/g, "");
    for (const t of tokens) expect(dump).not.toContain(t);
    expect(dump).not.toMatch(/dd1\./);
    for (const p of phones) {
      const local = p.replace(/\D/g, "").replace(/^84/, "0");
      expect(dump).not.toContain(p);
      expect(dump).not.toContain(local);
      expect(digitsOnly).not.toContain(local.slice(1)); // không lộ cả khi bỏ dấu cách/chấm
    }
  });
});
