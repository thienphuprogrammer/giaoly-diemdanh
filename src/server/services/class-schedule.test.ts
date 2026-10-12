import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { classCatechists, classes, users } from "@/db/schema";
import { auditRows, breakAuditInserts } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { getClassSchedule, setClassSchedule } from "./class-schedule";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [unassigned] = await db.insert(users).values({ email: "free@x.vn", name: "Free", passwordHash: "x", gradeId: b.gradeId }).returning();
  const [otherHead] = await db.insert(users).values({ email: "h2@x.vn", name: "H2", passwordHash: "x", gradeId: b.otherGradeId, isGradeHead: true }).returning();
  const schedule = async (id = b.classId) => (await db.select({ on: classes.meetsOn, at: classes.meetsAt }).from(classes).where(eq(classes.id, id)))[0];
  return { db, b, unassigned, otherHead, schedule };
}

describe("setClassSchedule: authorisation matrix", () => {
  it.each([
    ["assigned catechist", "glv", true],
    ["head of the class's grade (read-only by the global constraint)", "head", false],
    ["head of another grade", "otherHead", false],
    ["catechist of another class", "otherGlv", false],
    ["unassigned catechist of the same grade", "unassigned", false],
  ] as const)("%s -> allowed=%s", async (_n, who, allowed) => {
    const { db, b, unassigned, otherHead, schedule } = await setup();
    const user = { glv: b.glv, head: b.head, otherGlv: b.otherGlv, unassigned, otherHead }[who];
    const r = await setClassSchedule(db, user, { classId: b.classId, meetsOn: 0, meetsAt: "08:00" });
    if (allowed) {
      expect(r).toEqual({ ok: true, data: { meetsOn: 0, meetsAt: "08:00" } });
      expect(await schedule()).toEqual({ on: 0, at: "08:00:00" });
    } else {
      expect(r).toEqual({ ok: false, error: FORBIDDEN });
      expect(await schedule()).toEqual({ on: null, at: null });
      expect(await auditRows(db)).toEqual([]);
    }
  });

  it("hides missing classes and malformed ids behind the same refusal", async () => {
    const { db, b } = await setup();
    expect(await setClassSchedule(db, b.glv, { classId: crypto.randomUUID(), meetsOn: 1, meetsAt: "08:00" })).toEqual({ ok: false, error: FORBIDDEN });
    expect(await setClassSchedule(db, b.glv, { classId: "nope", meetsOn: 1, meetsAt: "08:00" })).toEqual({ ok: false, error: FORBIDDEN });
    expect(await setClassSchedule(db, b.glv, null)).toEqual({ ok: false, error: FORBIDDEN });
  });

  it("a catechist losing the assignment loses the right", async () => {
    const { db, b } = await setup();
    await db.delete(classCatechists).where(eq(classCatechists.userId, b.glv.id));
    expect((await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: 1, meetsAt: "08:00" })).ok).toBe(false);
  });
});

describe("setClassSchedule: values and audit", () => {
  it.each([[0, "00:00"], [6, "23:59"]])("accepts boundary %s %s", async (day, time) => {
    const { db, b, schedule } = await setup();
    expect((await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: day, meetsAt: time })).ok).toBe(true);
    expect(await schedule()).toEqual({ on: day, at: `${time}:00` });
  });

  it.each([
    [7, "08:00"], [-1, "08:00"], [1, "24:00"], [1, "8:00"], [1, null], [null, "08:00"],
  ])("refuses %s %s with a Vietnamese message and writes nothing", async (day, time) => {
    const { db, b, schedule } = await setup();
    const r = await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: day, meetsAt: time });
    expect(r.ok).toBe(false);
    expect(await schedule()).toEqual({ on: null, at: null });
    expect(await auditRows(db)).toEqual([]);
  });

  it("audits a change with before/after, writes nothing for the same value, and audits a clear", async () => {
    const { db, b, schedule } = await setup();
    await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: "0", meetsAt: "08:00" });
    await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: 0, meetsAt: "08:00" });
    await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: "", meetsAt: "" });
    expect(await schedule()).toEqual({ on: null, at: null });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      actorId: b.glv.id, classId: b.classId, gradeId: null, entity: "class", entityId: b.classId, action: "class.schedule",
      summary: { className: "Lớp A", before: null, after: "Chủ nhật 08:00" },
    });
    expect(rows[1]).toMatchObject({ actorId: b.glv.id, summary: { className: "Lớp A", before: "Chủ nhật 08:00", after: null } });
  });

  it("rolls the change back when the audit insert fails", async () => {
    const { db, b, schedule } = await setup();
    await breakAuditInserts(db);
    await expect(setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: 2, meetsAt: "09:00" })).rejects.toThrow();
    expect(await schedule()).toEqual({ on: null, at: null });
  });
});

describe("getClassSchedule", () => {
  it("returns the schedule with canEdit for assigned catechists only; the grade head reads it; null outside read access", async () => {
    const { db, b, unassigned } = await setup();
    await setClassSchedule(db, b.glv, { classId: b.classId, meetsOn: 6, meetsAt: "17:30" });
    expect(await getClassSchedule(db, b.glv, b.classId)).toEqual({ meetsOn: 6, meetsAt: "17:30", label: "Thứ bảy 17:30", canEdit: true });
    expect(await getClassSchedule(db, b.head, b.classId)).toEqual({ meetsOn: 6, meetsAt: "17:30", label: "Thứ bảy 17:30", canEdit: false });
    expect(await getClassSchedule(db, unassigned, b.classId)).toBeNull();
    expect(await getClassSchedule(db, b.otherGlv, b.classId)).toBeNull();
    expect(await getClassSchedule(db, b.glv, "bad")).toBeNull();
  });
});
