import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getPlan } from "@/db/queries/seating";
import { seatAssignments, seatingPlans, students } from "@/db/schema";
import type { BenchItem } from "@/lib/seating/types";
import { parseLayout } from "@/lib/seating/layout";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { activatePlan, assignSeat, createPlan, deletePlan, saveLayout } from "./seating";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const created = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 1" });
  if (!created.ok) throw new Error("setup");
  const planId = created.data.id;
  const data = await getPlan(db, planId);
  const benches = data!.plan.layout.flatMap((r) => r.items).filter((i): i is BenchItem => i.type === "bench");
  const kid = async (name: string, extra: Partial<typeof students.$inferInsert> = {}) =>
    (await db.insert(students).values({ classId: b.classId, fullName: name, ...extra }).returning())[0];
  return { db, b, planId, benches, kid };
}

describe("createPlan", () => {
  it("makes the first plan active, later ones inactive, with a valid default layout", async () => {
    const { db, b, planId } = await setup();
    const second = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 2" });
    if (!second.ok) throw new Error("setup");
    const [p1] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, planId));
    const [p2] = await db.select().from(seatingPlans).where(eq(seatingPlans.id, second.data.id));
    expect([p1.isActive, p2.isActive]).toEqual([true, false]);
    expect(parseLayout(p1.layout).ok).toBe(true);
  });

  it("is forbidden for other classes' catechists and read-only heads, and rejects blank names", async () => {
    const { db, b } = await setup();
    expect((await createPlan(db, b.otherGlv, { classId: b.classId, name: "X" })).ok).toBe(false);
    expect((await createPlan(db, b.head, { classId: b.classId, name: "X" })).ok).toBe(false);
    expect((await createPlan(db, b.glv, { classId: b.classId, name: "  " })).ok).toBe(false);
  });
});

describe("saveLayout", () => {
  it("rejects an invalid layout and keeps the stored one", async () => {
    const { db, b, planId } = await setup();
    const before = (await getPlan(db, planId))!.plan.layout;
    const r = await saveLayout(db, b.glv, { planId, layout: [{ id: "r", items: [{ type: "bench", id: "x", seats: 5 }] }] });
    expect(r).toEqual({ ok: false, error: "Mỗi băng có từ 2 đến 4 ghế" });
    expect((await getPlan(db, planId))!.plan.layout).toEqual(before);
  });

  it("prunes assignments of a removed bench", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    const layout = (await getPlan(db, planId))!.plan.layout.map((row) => ({ ...row, items: row.items.filter((i) => i.id !== benches[0].id) }));
    const r = await saveLayout(db, b.glv, { planId, layout });
    expect(r.ok && r.data.assignments).toEqual([]);
    expect(await db.select().from(seatAssignments)).toHaveLength(0);
  });
});

describe("assignSeat", () => {
  it("seats, moves (one row per student) and replaces an occupant", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 1, studentId: an.id });
    expect(await db.select().from(seatAssignments)).toHaveLength(1);
    const r = await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 1, studentId: binh.id });
    expect(r.ok && r.data.assignments).toEqual([{ benchId: benches[0].id, seatIndex: 1, studentId: binh.id }]);
  });

  it("clears a seat when studentId is null", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id });
    const r = await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: null });
    expect(r.ok && r.data.assignments).toEqual([]);
  });

  it("rejects hidden students, students of another class and unknown seats", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const hidden = await kid("Ẩn", { active: false });
    const [stranger] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Lạ" }).returning();
    expect((await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: hidden.id })).ok).toBe(false);
    expect((await assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: stranger.id })).ok).toBe(false);
    const an = await kid("An");
    expect((await assignSeat(db, b.glv, { planId, benchId: "nope", seatIndex: 0, studentId: an.id })).ok).toBe(false);
  });

  it("is forbidden for a catechist of another class", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    expect((await assignSeat(db, b.otherGlv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id })).ok).toBe(false);
  });
});

describe("activatePlan / deletePlan", () => {
  it("keeps exactly one active plan and refuses to delete the active one", async () => {
    const { db, b, planId } = await setup();
    const second = await createPlan(db, b.glv, { classId: b.classId, name: "Sơ đồ 2" });
    if (!second.ok) throw new Error("setup");
    expect((await deletePlan(db, b.glv, { planId })).ok).toBe(false);
    expect((await activatePlan(db, b.glv, { planId: second.data.id })).ok).toBe(true);
    const active = (await db.select().from(seatingPlans)).filter((p) => p.isActive);
    expect(active.map((p) => p.id)).toEqual([second.data.id]);
    expect((await deletePlan(db, b.glv, { planId })).ok).toBe(true);
  });
});

describe("concurrency", () => {
  it("createPlan: concurrent first plans leave exactly one active", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const rs = await Promise.all([
      createPlan(db, b.glv, { classId: b.classId, name: "A" }),
      createPlan(db, b.glv, { classId: b.classId, name: "B" }),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    const plans = await db.select().from(seatingPlans).where(eq(seatingPlans.classId, b.classId));
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.isActive)).toHaveLength(1);
  });

  it("assignSeat: concurrent assignments of different students both persist", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    const rs = await Promise.all([
      assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id }),
      assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 1, studentId: binh.id }),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(await db.select().from(seatAssignments)).toHaveLength(2);
  });

  it("saveLayout vs assignSeat never leaves an assignment for a missing seat", async () => {
    const { db, b, planId, benches, kid } = await setup();
    const an = await kid("An");
    const layout = (await getPlan(db, planId))!.plan.layout.map((row) => ({
      ...row,
      items: row.items.filter((i) => i.id !== benches[0].id),
    }));
    await Promise.all([
      saveLayout(db, b.glv, { planId, layout }),
      assignSeat(db, b.glv, { planId, benchId: benches[0].id, seatIndex: 0, studentId: an.id }),
    ]);
    const data = (await getPlan(db, planId))!;
    const ids = new Set(data.plan.layout.flatMap((r) => r.items).map((i) => i.id));
    expect(data.assignments.every((a) => ids.has(a.benchId))).toBe(true);
  });
});
