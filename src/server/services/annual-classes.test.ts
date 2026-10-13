import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listClassesForUser } from "@/db/queries/classes";
import { listTerms, resolveTerm } from "@/db/queries/stats";
import { listStudents } from "@/db/queries/students";
import { attendance, classCatechists, classMemberships, classes, schoolYears, sessions, students, terms, users } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { openSession, setStatus } from "./attendance";
import { homeOverview } from "./home";
import { openMassForClassDate } from "./mass-sessions";
import { massStats } from "./mass-stats";
import { applyPromotion, promotionTargets, undoPromotion } from "./promotions";
import { createSchoolYear, deleteSchoolYear, listSchoolYearsForUser, renameSchoolYear, resolveSchoolYearForUser } from "./school-years";
import { classStats, gradeOverview } from "./stats";
import { getStudentProfile } from "./student-profile";
import { classTermReport } from "./term-report";

const TODAY = "2026-10-13";
const NOW = new Date("2026-10-13T05:00:00Z");

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [admin] = await db.insert(users).values({ email: "admin@annual.vn", name: "Admin", passwordHash: "x", isAdmin: true }).returning();
  const [year] = await db.insert(schoolYears).values({ name: "2027-2028" }).returning();
  const [term] = await db.insert(terms).values({ schoolYearId: year.id, name: "Học kỳ 1", startsOn: "2027-09-01", endsOn: "2028-01-15" }).returning();
  const [next, crossGrade] = await db.insert(classes).values([
    { name: "Lớp A", gradeId: b.gradeId, schoolYearId: year.id },
    { name: "Lớp B", gradeId: b.otherGradeId, schoolYearId: year.id },
  ]).returning();
  await db.insert(classCatechists).values({ classId: next.id, userId: b.glv.id });
  const kid = async (name: string, classId = b.classId) =>
    (await db.insert(students).values({ fullName: name, classId }).returning())[0];
  return { db, b, admin, year, term, next, crossGrade, kid };
}

describe("annual class isolation", () => {
  it("distinguishes repeated class names by year and keeps admin/teacher scopes", async () => {
    const { db, b, admin, year, next, crossGrade } = await setup();
    const all = await listClassesForUser(db, admin);
    expect(all).toHaveLength(4);
    expect(all.every((c) => c.canWrite)).toBe(true);
    const future = await listClassesForUser(db, admin, year.id);
    expect(future.map((c) => c.id).sort()).toEqual([next.id, crossGrade.id].sort());
    expect(future.every((c) => c.schoolYearName === year.name && c.yearId === year.id)).toBe(true);
    expect((await listClassesForUser(db, b.glv)).map((c) => c.id).sort()).toEqual([b.classId, next.id].sort());
    expect(await listClassesForUser(db, b.glv, "bad-id")).toEqual([]);
    expect(await listTerms(db, "not-a-uuid")).toEqual([]);
    expect(await resolveTerm(db, undefined, TODAY, "not-a-uuid")).toBeNull();
  });

  it("defaults home to the current year and permits explicit future/year selection", async () => {
    const { db, b, admin, year, next } = await setup();
    expect((await resolveSchoolYearForUser(db, admin, undefined, TODAY))?.id).toBe(b.yearId);
    const current = await homeOverview(db, admin, TODAY);
    expect(current.schoolYear?.id).toBe(b.yearId);
    expect(current.classes.map((c) => c.id).sort()).toEqual([b.classId, b.otherClassId].sort());
    const selected = await homeOverview(db, b.glv, TODAY, year.id);
    expect(selected.schoolYear?.id).toBe(year.id);
    expect(selected.classes.map((c) => c.id)).toEqual([next.id]);
    expect(selected.activeTerm).toBeNull();
    const [empty] = await db.insert(schoolYears).values({ name: "Năm chuẩn bị" }).returning();
    expect((await listSchoolYearsForUser(db, b.head)).map((y) => y.id)).toContain(empty.id);
    expect((await listSchoolYearsForUser(db, b.glv)).map((y) => y.id)).not.toContain(empty.id);
  });

  it("rejects sessions in another year's dates while preserving first-week Sunday fallback", async () => {
    const { db, b, admin, next } = await setup();
    expect(await openSession(db, admin, { classId: b.classId, heldOn: "2027-09-05" }, new Date("2027-10-13T05:00:00Z")))
      .toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    expect(await openSession(db, admin, { classId: next.id, heldOn: TODAY }, NOW))
      .toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    const mass = await openMassForClassDate(db, b.glv, { classId: b.classId, heldOn: "2026-09-05" }, NOW);
    expect(mass).toMatchObject({ ok: true, data: { sunday: "2026-08-30" } });
    const [held] = await db.select().from(sessions);
    expect(held.termId).toBe(b.termId);
  });

  it("rejects explicit mismatched report terms and scopes each grade overview to its term year", async () => {
    const { db, b, admin, term, next } = await setup();
    expect(await classStats(db, admin, b.classId, term.id, TODAY)).toBeNull();
    expect(await massStats(db, admin, { classId: b.classId, termId: term.id, today: TODAY })).toBeNull();
    expect(await classTermReport(db, admin, b.classId, term.id, TODAY)).toBeNull();
    expect((await massStats(db, admin, { classId: b.classId, today: "2028-09-01" }))?.term.id).toBe(b.termId);
    expect((await gradeOverview(db, b.head, b.termId, TODAY))?.map((c) => c.classId)).toEqual([b.classId]);
    expect((await gradeOverview(db, admin, term.id, TODAY, b.gradeId))?.map((c) => c.classId)).toEqual([next.id]);
  });
});

describe("annual transfer history", () => {
  it("preserves never-marked children, QR identity and read-only old profiles after a forward-year transfer", async () => {
    const { db, b, admin, next, kid } = await setup();
    const quiet = await kid("Chưa điểm danh");
    expect(await applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: next.id, studentIds: [quiet.id] }))
      .toMatchObject({ ok: true, data: { moved: 1 } });
    expect(await listStudents(db, b.classId)).toMatchObject([{ id: quiet.id, former: true }]);
    const [stored] = await db.select().from(students).where(eq(students.id, quiet.id));
    expect(stored.qrToken).toBe(quiet.qrToken);
    const profile = await getStudentProfile(db, b.glv, { classId: b.classId, studentId: quiet.id, today: "2028-02-01" });
    expect(profile).toMatchObject({ former: true, canWrite: false, records: [] });
    expect(await getStudentProfile(db, b.otherGlv, { classId: b.classId, studentId: quiet.id, today: TODAY })).toBeNull();
    const stats = await classStats(db, admin, b.classId, b.termId, "2028-02-01");
    expect(stats?.rows).toMatchObject([{ studentId: quiet.id, former: true, summary: { marked: 0 } }]);
    const mass = await massStats(db, admin, { classId: b.classId, termId: b.termId, today: "2028-02-01" });
    expect(mass?.rows.map((s) => s.studentId)).toEqual(stats?.rows.map((s) => s.studentId));
    expect((await listClassesForUser(db, admin, b.yearId, "2028-02-01"))[0].studentCount).toBe(1);
    const old = await openSession(db, admin, { classId: b.classId, heldOn: TODAY }, NOW);
    if (!old.ok) throw new Error(old.error);
    expect(await setStatus(db, admin, { sessionId: old.data.id, studentId: quiet.id, status: "present", reason: null }))
      .toEqual({ ok: false, error: "Không tìm thấy thiếu nhi" });
  });

  it("allows admin transfers across grades, rejects backward years and retains same-year class changes", async () => {
    const { db, b, admin, next, crossGrade, kid } = await setup();
    const child = await kid("An");
    expect((await promotionTargets(db, admin))?.sources).toHaveLength(4);
    expect(await applyPromotion(db, b.head, { fromClassId: b.classId, toClassId: crossGrade.id, studentIds: [child.id] }))
      .toMatchObject({ ok: false });
    const forward = await applyPromotion(db, admin, { fromClassId: b.classId, toClassId: crossGrade.id, studentIds: [child.id] });
    expect(forward).toMatchObject({ ok: true, data: { moved: 1 } });
    expect(await applyPromotion(db, admin, { fromClassId: crossGrade.id, toClassId: b.classId, studentIds: [child.id] }))
      .toMatchObject({ ok: false });
    expect(await applyPromotion(db, admin, { fromClassId: crossGrade.id, toClassId: next.id, studentIds: [child.id] }))
      .toMatchObject({ ok: true, data: { moved: 1 } });
  });

  it("undo removes only newly added, unmarked destination membership and preserves prior history", async () => {
    const { db, b, admin, next, kid } = await setup();
    const fresh = await kid("Mới");
    const previous = await kid("Từng học", next.id);
    await db.update(students).set({ classId: b.classId }).where(eq(students.id, previous.id));
    const moved = await applyPromotion(db, admin, { fromClassId: b.classId, toClassId: next.id, studentIds: [fresh.id, previous.id] });
    if (!moved.ok || !moved.data.promotionId) throw new Error("Transfer should succeed");
    expect(await undoPromotion(db, admin, { promotionId: moved.data.promotionId })).toMatchObject({ ok: true, data: { restored: 2 } });
    expect((await listStudents(db, next.id)).map((s) => [s.id, s.former])).toEqual([[previous.id, true]]);
    expect((await listStudents(db, b.classId)).every((s) => !s.former)).toBe(true);
    expect((await db.select().from(classMemberships).where(eq(classMemberships.studentId, fresh.id))).map((m) => m.classId)).toEqual([b.classId]);
  });

  it("undo keeps destination membership when real attendance was recorded there", async () => {
    const { db, b, admin, term, next, kid } = await setup();
    const child = await kid("Đã dự lớp mới");
    const moved = await applyPromotion(db, admin, { fromClassId: b.classId, toClassId: next.id, studentIds: [child.id] });
    if (!moved.ok || !moved.data.promotionId) throw new Error("Transfer should succeed");
    const [held] = await db.insert(sessions).values({ classId: next.id, termId: term.id, heldOn: "2027-09-05" }).returning();
    await db.insert(attendance).values({ sessionId: held.id, studentId: child.id, status: "present" });
    expect((await undoPromotion(db, admin, { promotionId: moved.data.promotionId })).ok).toBe(true);
    expect(await listStudents(db, next.id)).toMatchObject([{ id: child.id, former: true }]);
  });
});

describe("admin school-year management", () => {
  it("permits early preparation and label changes while keeping year IDs and existing classes", async () => {
    const { db, b, admin } = await setup();
    const draft = {
      name: "2029-2030", term1: { name: "HK1", startsOn: "2029-09-01", endsOn: "2030-01-15" },
      term2: { name: "HK2", startsOn: "2030-01-16", endsOn: "2030-05-31" },
    };
    expect((await createSchoolYear(db, b.head, draft, TODAY)).ok).toBe(false);
    expect((await createSchoolYear(db, admin, draft, TODAY)).ok).toBe(true);
    expect((await renameSchoolYear(db, b.head, { schoolYearId: b.yearId, name: "Tên mới" })).ok).toBe(false);
    expect((await renameSchoolYear(db, admin, { schoolYearId: b.yearId, name: "Niên khóa 2026–2027" })).ok).toBe(true);
    expect((await db.select().from(classes).where(eq(classes.id, b.classId)))[0].schoolYearId).toBe(b.yearId);
    expect(await deleteSchoolYear(db, admin, { schoolYearId: b.yearId })).toEqual({ ok: false, error: "Năm học đã có lớp, không xoá được" });
    expect((await renameSchoolYear(db, admin, { schoolYearId: b.yearId, name: " 2029-2030 " })).ok).toBe(false);
  });
});
