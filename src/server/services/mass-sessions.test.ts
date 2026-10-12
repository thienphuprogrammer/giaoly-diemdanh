import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sessions } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { openSession } from "./attendance";
import { openMassForClassDate, openMassSession } from "./mass-sessions";

const LATE_NOW = new Date("2027-02-01T05:00:00Z");

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  return { db, b };
}

describe("openMassSession", () => {
  it("creates a 'mass' session and is idempotent", async () => {
    const { db, b } = await setup();
    const first = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    const again = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.data.id).toBe(first.data.id);
    const rows = await db.select().from(sessions).where(eq(sessions.classId, b.classId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "mass", heldOn: "2026-10-11", termId: b.termId, cancelled: false });
  });

  it("coexists with a class session on the same day; neither open returns the other", async () => {
    const { db, b } = await setup();
    const cls = await openSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    const mass = await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    const clsAgain = await openSession(db, b.glv, { classId: b.classId, heldOn: "2026-10-11" }, LATE_NOW);
    if (!cls.ok || !mass.ok || !clsAgain.ok) throw new Error("open failed");
    expect(mass.data.id).not.toBe(cls.data.id);
    expect(clsAgain.data.id).toBe(cls.data.id);
    const kinds = await db.select({ kind: sessions.kind }).from(sessions)
      .where(and(eq(sessions.classId, b.classId), eq(sessions.heldOn, "2026-10-11")));
    expect(kinds.map((k) => k.kind).sort()).toEqual(["class", "mass"]);
  });

  it("accepts a non-Sunday date only when chosen manually (feast days)", async () => {
    const { db, b } = await setup();
    expect(await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-12-08" }, LATE_NOW))
      .toEqual({ ok: false, error: "Buổi đi lễ phải vào Chúa nhật (hoặc chọn ngày lễ thủ công)" });
    expect(await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-12-08", manual: false }, LATE_NOW))
      .toEqual({ ok: false, error: "Buổi đi lễ phải vào Chúa nhật (hoặc chọn ngày lễ thủ công)" });
    expect(await db.select().from(sessions)).toHaveLength(0);
    expect((await openMassSession(db, b.glv, { classId: b.classId, heldOn: "2026-12-08", manual: true }, LATE_NOW)).ok).toBe(true);
  });

  it("only lets assigned catechists open it; others get the same 'not found'", async () => {
    const { db, b } = await setup();
    const input = { classId: b.classId, heldOn: "2026-10-11" };
    const head = await openMassSession(db, b.head, input, LATE_NOW);
    const other = await openMassSession(db, b.otherGlv, input, LATE_NOW);
    const unknown = await openMassSession(db, b.glv, { ...input, classId: "00000000-0000-4000-8000-000000000000" }, LATE_NOW);
    expect(head).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect(other).toEqual(head);
    expect(unknown).toEqual(head);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("validates the date: format, future days (Vietnam time) and term coverage", async () => {
    const { db, b } = await setup();
    const now = new Date("2026-10-11T05:00:00Z");
    const open = (heldOn: unknown) => openMassSession(db, b.glv, { classId: b.classId, heldOn }, now);
    expect((await open("11/10/2026")).ok).toBe(false);
    expect((await open("2026-02-30")).ok).toBe(false);
    expect((await open(undefined)).ok).toBe(false);
    expect(await open("2026-10-18")).toEqual({ ok: false, error: "Không thể điểm danh cho ngày chưa tới" });
    expect(await open("2026-08-30")).toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    expect((await openMassSession(db, b.glv, null, now)).ok).toBe(false);
  });
});

describe("openMassForClassDate (the board's entry point: takes the CLASS date)", () => {
  const massOf = async (db: Awaited<ReturnType<typeof setup>>["db"], id: string) =>
    (await db.select().from(sessions).where(eq(sessions.id, id)))[0];

  it.each([
    ["Saturday class -> the Sunday before", "2026-10-10", "2026-10-04"],
    ["Sunday class -> that same Sunday", "2026-10-11", "2026-10-11"],
    ["weekday class -> the Sunday before", "2026-10-14", "2026-10-11"],
  ])("%s", async (_label, classDate, sunday) => {
    const { db, b } = await setup();
    const r = await openMassForClassDate(db, b.glv, { classId: b.classId, heldOn: classDate }, LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.sunday).toBe(sunday);
    expect(await massOf(db, r.data.id)).toMatchObject({ kind: "mass", heldOn: sunday, termId: b.termId });
    const again = await openMassForClassDate(db, b.glv, { classId: b.classId, heldOn: classDate }, LATE_NOW);
    expect(again).toEqual(r);
  });

  it("first week of the term: a Sunday before terms.starts_on is stored in the class date's term", async () => {
    // Học kỳ bắt đầu thứ Ba 01/09/2026; lớp thứ Bảy 05/09 -> Chúa nhật 30/08 (ngoài mọi học kỳ).
    const { db, b } = await setup();
    const r = await openMassForClassDate(db, b.glv, { classId: b.classId, heldOn: "2026-09-05" }, LATE_NOW);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.sunday).toBe("2026-08-30");
    expect(await massOf(db, r.data.id)).toMatchObject({ kind: "mass", heldOn: "2026-08-30", termId: b.termId });
  });

  it("rejects a class date outside every term, a future class date, bad input and non-writers", async () => {
    const { db, b } = await setup();
    const now = new Date("2026-10-12T05:00:00Z");
    const open = (input: unknown, user = b.glv) => openMassForClassDate(db, user, input, now);
    expect(await open({ classId: b.classId, heldOn: "2026-08-29" })).toEqual({ ok: false, error: "Ngày này không thuộc học kỳ nào" });
    expect(await open({ classId: b.classId, heldOn: "2026-10-17" })).toEqual({ ok: false, error: "Không thể điểm danh cho ngày chưa tới" });
    expect((await open({ classId: b.classId, heldOn: "2026-02-30" })).ok).toBe(false);
    expect((await open(null)).ok).toBe(false);
    expect(await open({ classId: b.classId, heldOn: "2026-10-10" }, b.head)).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect(await open({ classId: b.classId, heldOn: "2026-10-10" }, b.otherGlv)).toEqual({ ok: false, error: "Không tìm thấy lớp" });
    expect(await db.select().from(sessions)).toHaveLength(0);
  });
});
