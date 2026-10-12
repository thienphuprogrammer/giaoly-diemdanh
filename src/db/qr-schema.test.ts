import { describe, expect, it } from "vitest";
import { attendance, attendanceScans, sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { QR_MIGRATION, createTestDbBeforeMigration } from "@/test/migration";
import { seedBasics } from "@/test/fixtures";

const HEX32 = /^[0-9a-f]{32}$/;

describe("QR schema", () => {
  it("gives every new student a unique 32-hex token", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const rows = await db.insert(students).values([
      { classId: b.classId, fullName: "An" }, { classId: b.classId, fullName: "Bình" },
    ]).returning({ token: students.qrToken });
    expect(rows[0].token).toMatch(HEX32);
    expect(rows[1].token).toMatch(HEX32);
    expect(rows[0].token).not.toBe(rows[1].token);
  });

  it("backfills a distinct token for students that existed before the migration", async () => {
    const { client, apply } = await createTestDbBeforeMigration(QR_MIGRATION);
    await client.exec("insert into grades (name) values ('K')");
    await client.exec("insert into classes (grade_id, name) select id, 'L' from grades");
    await client.exec("insert into students (class_id, full_name) select id, 'A' from classes");
    await client.exec("insert into students (class_id, full_name) select id, 'B' from classes");
    await apply();
    const { rows } = await client.query<{ qr_token: string }>("select qr_token from students");
    expect(rows).toHaveLength(2);
    expect(rows[0].qr_token).toMatch(HEX32);
    expect(rows[0].qr_token).not.toBe(rows[1].qr_token);
  });

  it("enforces unique tokens and unique event ids", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    await expect(db.insert(students).values({ classId: b.classId, fullName: "X", qrToken: kid.qrToken })).rejects.toThrow();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
    const row = { eventId: crypto.randomUUID(), kind: "scan" as const, sessionId: session.id, studentId: kid.id, actorId: b.glv.id, payloadHash: "h", result: "applied" as const };
    await db.insert(attendanceScans).values(row);
    await expect(db.insert(attendanceScans).values(row)).rejects.toThrow();
  });

  it("keeps last_event_id empty by default on attendance rows", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();
    const [row] = await db.insert(attendance).values({ sessionId: session.id, studentId: kid.id, status: "present" }).returning();
    expect(row.lastEventId).toBeNull();
  });
});
