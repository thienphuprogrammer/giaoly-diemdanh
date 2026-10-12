import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, classes, promotions, students } from "@/db/schema";
import type { Db } from "@/db/types";
import { STALE_PROMOTION } from "@/lib/promotion";
import { seedBasics, type Basics } from "@/test/fixtures";
import { createRealPgDb, realPgUrl } from "@/test/pg";
import { applyPromotion, undoPromotion } from "./promotions";

/** Đua thật trên Postgres (nhiều kết nối): mỗi Promise.all chạy song song, lặp vài vòng với lớp/em mới. */
const ROUNDS = 4;

describe.skipIf(!realPgUrl)("promotion races on real Postgres", () => {
  let db: Db;
  let b: Basics;
  let close: () => Promise<void>;
  let n = 0;

  beforeAll(async () => {
    ({ db, close } = await createRealPgDb(12));
    b = await seedBasics(db);
  });
  afterAll(async () => { await close?.(); });

  /** Một lớp nguồn có 3 em và hai lớp đích, tất cả trong khối của trưởng khối. */
  async function fresh() {
    n += 1;
    const [from, to, other] = await db.insert(classes).values(["Nguồn", "Đích", "Khác"].map((name) => ({ gradeId: b.gradeId, name: `${name} ${n}` }))).returning();
    const kids = await db.insert(students).values(["Một", "Hai", "Ba"].map((x) => ({ classId: from.id, fullName: `Em ${x} ${n}` }))).returning();
    return { from, to, other, ids: kids.map((k) => k.id) };
  }
  const classesOf = async (ids: string[]) => (await db.select({ c: students.classId }).from(students).where(inArray(students.id, ids))).map((r) => r.c);
  const auditOf = (promotionId: string) => db.select().from(auditEvents).where(eq(auditEvents.entityId, promotionId));

  it("two concurrent applies with the same client token move once and return the same promotion", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { from, to, ids } = await fresh();
      const clientToken = crypto.randomUUID();
      const input = { fromClassId: from.id, toClassId: to.id, studentIds: ids, clientToken };
      const [a, c] = await Promise.all([applyPromotion(db, b.head, input), applyPromotion(db, b.head, input)]);
      expect(a.ok && c.ok).toBe(true);
      const idA = a.ok ? a.data.promotionId : null;
      expect(idA).not.toBeNull();
      expect(c.ok && c.data.promotionId).toBe(idA);
      expect(await db.select().from(promotions).where(eq(promotions.fromClassId, from.id))).toHaveLength(1);
      expect(await auditOf(idA ?? "")).toHaveLength(2); // một dòng cho mỗi lớp
      expect(await classesOf(ids)).toEqual([to.id, to.id, to.id]);
    }
  });

  it("two concurrent undos: exactly one wins, students are back, undo audited once per class", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { from, to, ids } = await fresh();
      const r = await applyPromotion(db, b.head, { fromClassId: from.id, toClassId: to.id, studentIds: ids });
      const promotionId = r.ok ? r.data.promotionId ?? "" : "";
      const results = await Promise.all([undoPromotion(db, b.head, { promotionId }), undoPromotion(db, b.head, { promotionId })]);
      expect(results.filter((x) => x.ok)).toHaveLength(1);
      expect(results.find((x) => !x.ok)).toEqual({ ok: false, error: "Lượt lên lớp này đã được hoàn tác" });
      expect(await classesOf(ids)).toEqual([from.id, from.id, from.id]);
      expect((await auditOf(promotionId)).filter((a) => a.action === "promotion.undo")).toHaveLength(2);
    }
  });

  it("concurrent promotions of overlapping students to different classes: one wins whole, the other is refused", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { from, to, other, ids } = await fresh();
      const [x, y] = await Promise.all([
        applyPromotion(db, b.head, { fromClassId: from.id, toClassId: to.id, studentIds: ids }),
        applyPromotion(db, b.head, { fromClassId: from.id, toClassId: other.id, studentIds: ids.slice(1) }),
      ]);
      const wins = [x, y].filter((r) => r.ok);
      expect(wins).toHaveLength(1);
      expect([x, y].find((r) => !r.ok)).toEqual({ ok: false, error: STALE_PROMOTION });
      const where = await classesOf(ids);
      if (x.ok) expect(where).toEqual([to.id, to.id, to.id]);
      else expect(where.filter((c) => c === other.id)).toHaveLength(2);
      expect(await db.select().from(promotions).where(eq(promotions.fromClassId, from.id))).toHaveLength(1);
    }
  });
});
