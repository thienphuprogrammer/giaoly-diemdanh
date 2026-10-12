import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { attendanceScans, auditEvents, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { pruneAudit } from "./audit-retention";

const NOW = new Date("2027-10-12T05:00:00Z");

async function event(db: Db, classId: string, at: string) {
  const id = crypto.randomUUID();
  await db.execute(sql`insert into audit_events (id, at, class_id, entity, action) values (${id}::uuid, ${at}::timestamptz, ${classId}::uuid, 'student', 'student.create')`);
  return id;
}

describe("pruneAudit", () => {
  it("deletes audit events older than 365 days and keeps the boundary and newer ones", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const cutoff = new Date(NOW.getTime() - 365 * 86_400_000); // 2026-10-12T05:00:00Z
    const older = await event(db, b.classId, new Date(cutoff.getTime() - 1000).toISOString());
    const justOlder = await event(db, b.classId, new Date(cutoff.getTime() - 1).toISOString());
    const atBoundary = await event(db, b.classId, cutoff.toISOString());
    const newer = await event(db, b.classId, new Date(cutoff.getTime() + 1000).toISOString());
    const gradeLevel = await db.execute(sql`insert into audit_events (at, grade_id, entity, action) values ('2020-01-01T00:00:00Z', ${b.gradeId}::uuid, 'grade_settings', 'grade.mass_threshold') returning id`);
    expect(gradeLevel).toBeTruthy();
    const result = await pruneAudit(db, { now: NOW });
    expect(result).toEqual({ deleted: 3 });
    const left = (await db.select({ id: auditEvents.id }).from(auditEvents)).map((r) => r.id).sort();
    expect(left).toEqual([atBoundary, newer].sort());
    expect(left).not.toContain(older);
    expect(left).not.toContain(justOlder);
  });

  it("honours a custom window and is idempotent", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    await event(db, b.classId, "2027-10-01T00:00:00Z");
    await event(db, b.classId, "2027-09-01T00:00:00Z");
    expect(await pruneAudit(db, { olderThanDays: 30, now: NOW })).toEqual({ deleted: 1 });
    expect(await pruneAudit(db, { olderThanDays: 30, now: NOW })).toEqual({ deleted: 0 });
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });

  it("never touches attendance_scans, however old", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const sid = (await db.execute(sql`insert into sessions (class_id, term_id, held_on) values (${b.classId}::uuid, ${b.termId}::uuid, '2020-01-01') returning id`)) as unknown as { rows: { id: string }[] };
    await db.execute(sql`insert into attendance_scans (event_id, kind, session_id, student_id, payload_hash, result, received_at)
      values (${crypto.randomUUID()}::uuid, 'scan', ${sid.rows[0].id}::uuid, ${kid.id}::uuid, 'h', 'applied', '2019-01-01T00:00:00')`);
    await event(db, b.classId, "2019-01-01T00:00:00Z");
    expect(await pruneAudit(db, { now: NOW })).toEqual({ deleted: 1 });
    expect(await db.select().from(attendanceScans)).toHaveLength(1);
  });

  it("rejects a nonsensical window instead of deleting everything", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    await event(db, b.classId, "2020-01-01T00:00:00Z");
    for (const bad of [0, -5, Number.NaN, 1.5, Infinity, 0.0001]) await expect(pruneAudit(db, { olderThanDays: bad, now: NOW })).rejects.toThrow(/olderThanDays/);
    expect(await db.select().from(auditEvents)).toHaveLength(1);
  });
});
