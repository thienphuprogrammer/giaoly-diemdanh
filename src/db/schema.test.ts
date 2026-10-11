import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { seatAssignments, seatingPlans, sessions, students } from "@/db/schema";

async function setup() {
  const db = await createTestDb();
  const basics = await seedBasics(db);
  const [plan] = await db
    .insert(seatingPlans)
    .values({ classId: basics.classId, name: "A", layout: [] })
    .returning();
  const [kid] = await db
    .insert(students)
    .values({ classId: basics.classId, fullName: "Nguyễn An" })
    .returning();
  return { db, basics, plan, kid };
}

describe("schema constraints", () => {
  it("rejects a student seated twice in one plan", async () => {
    const { db, plan, kid } = await setup();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: kid.id });
    await expect(
      db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 1, studentId: kid.id }),
    ).rejects.toThrow();
  });

  it("rejects two students on one seat", async () => {
    const { db, basics, plan, kid } = await setup();
    const [other] = await db.insert(students).values({ classId: basics.classId, fullName: "Trần Bình" }).returning();
    await db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: kid.id });
    await expect(
      db.insert(seatAssignments).values({ planId: plan.id, benchId: "b1", seatIndex: 0, studentId: other.id }),
    ).rejects.toThrow();
  });

  it("allows only one active plan per class", async () => {
    const { db, basics } = await setup();
    await db.insert(seatingPlans).values({ classId: basics.classId, name: "B", layout: [], isActive: true });
    await expect(
      db.insert(seatingPlans).values({ classId: basics.classId, name: "C", layout: [], isActive: true }),
    ).rejects.toThrow();
  });

  it("allows one session per class per day", async () => {
    const { db, basics } = await setup();
    const row = { classId: basics.classId, termId: basics.termId, heldOn: "2026-10-11" };
    await db.insert(sessions).values(row);
    await expect(db.insert(sessions).values(row)).rejects.toThrow();
  });
});
