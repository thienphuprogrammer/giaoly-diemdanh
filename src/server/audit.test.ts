import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, students } from "@/db/schema";
import { AuditSummaryError } from "@/lib/audit/events";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { auditRow, recordAudit, writeWithAudit } from "./audit";

async function setup() {
  const db = await createTestDb();
  return { db, b: await seedBasics(db) };
}

describe("auditRow", () => {
  it("builds the insert values with a sanitized copy of the summary", () => {
    const summary = { studentName: "An" };
    const row = auditRow({ actorId: "u", classId: "c", entity: "student", entityId: "s", action: "student.create", summary });
    expect(row).toEqual({ actorId: "u", classId: "c", gradeId: null, entity: "student", entityId: "s", action: "student.create", summary: { studentName: "An" } });
    expect(row.summary).not.toBe(summary);
  });

  it("refuses an action that does not belong to the entity, an unknown action, or no class/grade scope", () => {
    expect(() => auditRow({ actorId: "u", classId: "c", entity: "student", action: "session.cancel", summary: {} })).toThrow(/entity/);
    // @ts-expect-error hành động lạ bị chặn cả lúc biên dịch lẫn lúc chạy
    expect(() => auditRow({ actorId: "u", classId: "c", entity: "student", action: "student.nuke", summary: {} })).toThrow(/action/);
    expect(() => auditRow({ actorId: "u", entity: "student", action: "student.create", summary: {} })).toThrow(/class or grade/);
  });

  it("refuses an unsafe summary", () => {
    expect(() => auditRow({ actorId: "u", classId: "c", entity: "student", action: "student.qr_rotate", summary: { qr_token: "x" } }))
      .toThrow(AuditSummaryError);
  });
});

describe("recordAudit", () => {
  it("inserts one row with actor, class, entity, action and summary", async () => {
    const { db, b } = await setup();
    await recordAudit(db, { actorId: b.glv.id, classId: b.classId, entity: "student", entityId: "x1", action: "student.create", summary: { studentName: "An" } });
    const rows = await db.select().from(auditEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: b.glv.id, classId: b.classId, gradeId: null, entity: "student", entityId: "x1", action: "student.create", summary: { studentName: "An" } });
  });

  it("is rolled back with the transaction it is part of", async () => {
    const { db, b } = await setup();
    await expect(db.transaction(async (tx) => {
      await tx.insert(students).values({ classId: b.classId, fullName: "An" });
      await recordAudit(tx, { actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.create", summary: {} });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(students)).toHaveLength(0);
  });
});

describe("writeWithAudit", () => {
  it("runs the write and the audit insert as one statement; one audit row when the write returned rows", async () => {
    const { db, b } = await setup();
    const write = db.insert(students).values({ classId: b.classId, fullName: "An" }).returning({ id: students.id });
    const n = await writeWithAudit(db, write, { actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.create", summary: { studentName: "An" } });
    expect(n).toBe(1);
    expect(await db.select().from(students)).toHaveLength(1);
    const rows = await db.select().from(auditEvents);
    expect(rows).toMatchObject([{ actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.create", summary: { studentName: "An" } }]);
  });

  it("writes no audit row when the write affected nothing", async () => {
    const { db, b } = await setup();
    const write = db.delete(students).where(eq(students.fullName, "nobody")).returning({ id: students.id });
    expect(await writeWithAudit(db, write, { actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.update", summary: {} })).toBe(0);
    expect(await db.select().from(auditEvents)).toHaveLength(0);
  });

  it("is atomic: a failing audit insert undoes the write", async () => {
    const { db, b } = await setup();
    await db.execute(sql`create function audit_fail() returns trigger language plpgsql as $$ begin raise exception 'audit down'; end $$`);
    await db.execute(sql`create trigger audit_fail before insert on audit_events for each row execute function audit_fail()`);
    const write = db.insert(students).values({ classId: b.classId, fullName: "An" }).returning({ id: students.id });
    await expect(writeWithAudit(db, write, { actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.create", summary: {} }))
      .rejects.toThrow();
    expect(await db.select().from(students)).toHaveLength(0);
  });

  it("validates the event before touching the database", async () => {
    const { db, b } = await setup();
    const write = db.insert(students).values({ classId: b.classId, fullName: "An" }).returning({ id: students.id });
    await expect(writeWithAudit(db, write, { actorId: b.glv.id, classId: b.classId, entity: "student", action: "student.create", summary: { token: "x" } }))
      .rejects.toThrow(AuditSummaryError);
    expect(await db.select().from(students)).toHaveLength(0);
  });
});
