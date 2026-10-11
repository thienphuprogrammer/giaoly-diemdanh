import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { getQrCards, rotateQrToken } from "./qr-cards";

const HEX32 = /^[0-9a-f]{32}$/;

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const kid = async (fullName: string, extra: Partial<typeof students.$inferInsert> = {}, classId = b.classId) =>
    (await db.insert(students).values({ classId, fullName, ...extra }).returning())[0];
  return { db, b, kid };
}

describe("getQrCards", () => {
  it("gives the class catechist the active students with their tokens, ordered by name", async () => {
    const { db, b, kid } = await setup();
    const [binh, an] = [await kid("Bình"), await kid("An")];
    await kid("Ẩn", { active: false });
    const cards = await getQrCards(db, b.glv, b.classId);
    expect(cards?.map((c) => c.fullName)).toEqual(["An", "Bình"]);
    expect(cards?.[0]).toMatchObject({ studentId: an.id, token: an.qrToken });
    expect(cards?.[1].token).toBe(binh.qrToken);
    expect(cards?.[0].token).toMatch(HEX32);
  });

  it("returns null for the read-only grade head, for another class's catechist and for malformed ids", async () => {
    const { db, b } = await setup();
    expect(await getQrCards(db, b.head, b.classId)).toBeNull();
    expect(await getQrCards(db, b.otherGlv, b.classId)).toBeNull();
    expect(await getQrCards(db, b.glv, "not-a-uuid")).toBeNull();
  });
});

describe("rotateQrToken", () => {
  it("replaces only that student's token; the old token stops matching anyone", async () => {
    const { db, b, kid } = await setup();
    const [an, binh] = [await kid("An"), await kid("Bình")];
    expect((await rotateQrToken(db, b.glv, { studentId: an.id })).ok).toBe(true);
    const [after] = await db.select().from(students).where(eq(students.id, an.id));
    expect(after.qrToken).toMatch(HEX32);
    expect(after.qrToken).not.toBe(an.qrToken);
    expect(await db.select().from(students).where(eq(students.qrToken, an.qrToken))).toHaveLength(0);
    const [other] = await db.select().from(students).where(eq(students.id, binh.id));
    expect(other.qrToken).toBe(binh.qrToken);
  });

  it("is refused for the read-only head and other classes' catechists, and leaves the token unchanged", async () => {
    const { db, b, kid } = await setup();
    const an = await kid("An");
    for (const user of [b.head, b.otherGlv]) {
      expect(await rotateQrToken(db, user, { studentId: an.id })).toEqual({ ok: false, error: "Không tìm thấy thiếu nhi" });
    }
    expect((await rotateQrToken(db, b.glv, { studentId: "not-a-uuid" })).ok).toBe(false);
    const [row] = await db.select().from(students).where(eq(students.id, an.id));
    expect(row.qrToken).toBe(an.qrToken);
  });
});
