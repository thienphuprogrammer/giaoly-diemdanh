import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { grades, users } from "@/db/schema";
import { auditRows, breakAuditInserts } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { nextGradeSettings, setNextGrade } from "./grade-settings";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [grade3] = await db.insert(grades).values({ name: "Khối 3" }).returning();
  const nextOf = async (id: string) => (await db.select({ n: grades.nextGradeId }).from(grades).where(eq(grades.id, id)))[0].n;
  return { db, b, grade3, nextOf };
}

describe("setNextGrade", () => {
  it("lets the head of the source grade pick an existing other grade, audited with names; same value writes nothing", async () => {
    const { db, b, nextOf } = await setup();
    expect(await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.otherGradeId })).toEqual({ ok: true, data: undefined });
    expect(await nextOf(b.gradeId)).toBe(b.otherGradeId);
    await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.otherGradeId });
    const rows = await auditRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: b.head.id, gradeId: b.gradeId, classId: null, entity: "grade_settings", entityId: b.gradeId, action: "grade.next_grade",
      summary: { gradeName: "Khối 1", before: null, after: "Khối 2" },
    });
  });

  it("clears the next grade with an empty value", async () => {
    const { db, b, nextOf } = await setup();
    await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.otherGradeId });
    expect((await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: "" })).ok).toBe(true);
    expect(await nextOf(b.gradeId)).toBeNull();
    expect((await auditRows(db)).at(-1)?.summary).toEqual({ gradeName: "Khối 1", before: "Khối 2", after: null });
  });

  it("refuses itself, a missing grade, and anyone but the head of the source grade", async () => {
    const { db, b, grade3, nextOf } = await setup();
    const [otherHead] = await db.insert(users).values({ email: "oh@x.vn", name: "oh", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning();
    expect(await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.gradeId })).toEqual({ ok: false, error: "Khối kế tiếp phải là một khối khác" });
    expect(await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: crypto.randomUUID() })).toEqual({ ok: false, error: "Không tìm thấy khối" });
    expect(await setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: "x" })).toEqual({ ok: false, error: "Không tìm thấy khối" });
    expect(await setNextGrade(db, b.glv, { gradeId: b.gradeId, nextGradeId: grade3.id })).toEqual({ ok: false, error: FORBIDDEN });
    expect(await setNextGrade(db, otherHead, { gradeId: b.gradeId, nextGradeId: grade3.id })).toEqual({ ok: false, error: FORBIDDEN });
    expect(await setNextGrade(db, b.head, { gradeId: b.otherGradeId, nextGradeId: grade3.id })).toEqual({ ok: false, error: FORBIDDEN });
    expect(await setNextGrade(db, b.head, null)).toMatchObject({ ok: false });
    expect(await nextOf(b.gradeId)).toBeNull();
    expect(await nextOf(b.otherGradeId)).toBeNull();
    expect(await auditRows(db)).toHaveLength(0);
  });

  it("rolls back when the audit insert fails", async () => {
    const { db, b, nextOf } = await setup();
    await breakAuditInserts(db);
    await expect(setNextGrade(db, b.head, { gradeId: b.gradeId, nextGradeId: b.otherGradeId })).rejects.toThrow();
    expect(await nextOf(b.gradeId)).toBeNull();
  });
});

describe("nextGradeSettings", () => {
  it("returns the current next grade and the other grades as options, for heads only", async () => {
    const { db, b } = await setup();
    expect(await nextGradeSettings(db, b.glv)).toBeNull();
    expect(await nextGradeSettings(db, b.head)).toEqual({
      gradeId: b.gradeId, gradeName: "Khối 1", nextGradeId: null,
      options: [{ id: b.otherGradeId, name: "Khối 2" }, { id: expect.any(String), name: "Khối 3" }],
    });
  });
});
