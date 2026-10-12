import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resolveTerm } from "@/db/queries/stats";
import { schoolYears, sessions, terms } from "@/db/schema";
import { auditRows, breakAuditInserts } from "@/test/audit";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { createSchoolYear, schoolYearOverview } from "./school-years";

const VALID = {
  name: "2027-2028",
  term1: { name: "Học kỳ 1", startsOn: "2027-09-01", endsOn: "2028-01-15" },
  term2: { name: "Học kỳ 2", startsOn: "2028-01-16", endsOn: "2028-05-31" },
};

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  return { db, b };
}

describe("createSchoolYear", () => {
  it("lets a grade head create a year with two terms and writes one audit row", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, VALID);
    expect(r.ok).toBe(true);
    const id = r.ok ? r.data.id : "";
    const [year] = await db.select().from(schoolYears).where(eq(schoolYears.id, id));
    expect(year.name).toBe("2027-2028");
    const rows = await db.select({ name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn }).from(terms).where(eq(terms.schoolYearId, id));
    expect(rows.sort((a, c) => a.startsOn.localeCompare(c.startsOn))).toEqual([VALID.term1, VALID.term2]);
    const audit = await auditRows(db);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: b.head.id, gradeId: b.gradeId, classId: null, entity: "school_year", entityId: id, action: "school_year.create",
      summary: { yearName: "2027-2028", term1Start: "2027-09-01", term1End: "2028-01-15", term2Start: "2028-01-16", term2End: "2028-05-31" },
    });
  });

  it("trims names and accepts form-shaped input", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, { ...VALID, name: "  2027-2028  ", term1: { ...VALID.term1, name: " HK1 " } });
    expect(r.ok).toBe(true);
    expect((await db.select().from(schoolYears)).map((y) => y.name)).toContain("2027-2028");
    expect((await db.select().from(terms)).map((t) => t.name)).toContain("HK1");
  });

  it.each([
    ["catechist", "glv"],
    ["catechist of another grade", "otherGlv"],
  ] as const)("refuses a %s", async (_label, who) => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b[who], VALID);
    expect(r).toEqual({ ok: false, error: "Bạn không có quyền thực hiện thao tác này" });
    expect(await db.select().from(schoolYears)).toHaveLength(1);
    expect(await auditRows(db)).toHaveLength(0);
  });

  it("refuses a head without a grade", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, { ...b.head, gradeId: null }, VALID);
    expect(r.ok).toBe(false);
  });

  it.each([
    [{ ...VALID, name: "" }, /tên năm học/i],
    [{ ...VALID, term1: { ...VALID.term1, name: "" } }, /tên học kỳ/i],
    [{ ...VALID, term1: { ...VALID.term1, startsOn: "2027-02-30" } }, /Ngày không hợp lệ/],
    [{ ...VALID, term1: { ...VALID.term1, endsOn: "2027-08-01" } }, /Học kỳ 1/],
    [{ ...VALID, term2: { ...VALID.term2, startsOn: "2028-01-10" } }, /sau khi học kỳ 1/],
    [{ ...VALID, term2: { ...VALID.term2, endsOn: "2029-05-31" } }, /quá dài/],
    [{ ...VALID, term1: { ...VALID.term1, startsOn: "1999-09-01" } }, /Ngày không hợp lệ/],
    ["not an object", /không hợp lệ/],
  ])("refuses invalid input %#", async (input, msg) => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, input);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(msg);
    expect(await db.select().from(schoolYears)).toHaveLength(1);
  });

  it("refuses a duplicate name (case and spaces ignored)", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, { ...VALID, name: " 2026-2027 " });
    expect(r).toEqual({ ok: false, error: "Đã có năm học tên này" });
  });

  it("refuses terms overlapping an existing term (seed term: 2026-09-01 → 2027-01-15)", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, {
      ...VALID,
      term1: { name: "HK1", startsOn: "2027-01-15", endsOn: "2027-03-01" },
      term2: { name: "HK2", startsOn: "2027-03-02", endsOn: "2027-05-31" },
    });
    expect(r).toEqual({ ok: false, error: "Học kỳ 1 trùng ngày với Học kỳ 1 (2026-2027)" });
    expect(await db.select().from(terms)).toHaveLength(1);
  });

  it("leaves old sessions untouched and rolls back everything when the audit insert fails", async () => {
    const { db, b } = await setup();
    await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" });
    await breakAuditInserts(db);
    await expect(createSchoolYear(db, b.head, VALID)).rejects.toThrow();
    expect(await db.select().from(schoolYears)).toHaveLength(1);
    expect(await db.select().from(terms)).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});

describe("resolveTerm with two school years", () => {
  it("picks the term that contains the day, the newest term in a gap between years, and an explicit id first", async () => {
    const { db, b } = await setup();
    const r = await createSchoolYear(db, b.head, VALID);
    expect(r.ok).toBe(true);
    expect((await resolveTerm(db, undefined, "2026-10-12"))?.id).toBe(b.termId);
    expect((await resolveTerm(db, undefined, "2027-09-01"))?.name).toBe("Học kỳ 1");
    expect((await resolveTerm(db, undefined, "2027-09-01"))?.startsOn).toBe("2027-09-01");
    expect((await resolveTerm(db, undefined, "2028-01-16"))?.startsOn).toBe("2028-01-16");
    // Hè giữa hai năm học: không học kỳ nào chứa ngày → học kỳ mới nhất (năm sau).
    expect((await resolveTerm(db, undefined, "2027-07-01"))?.startsOn).toBe("2028-01-16");
    expect((await resolveTerm(db, b.termId, "2028-01-20"))?.id).toBe(b.termId);
  });
});

describe("schoolYearOverview", () => {
  it("lists years newest first with defaults shifted from the latest year, for heads only", async () => {
    const { db, b } = await setup();
    await db.insert(terms).values({ schoolYearId: b.term.schoolYearId, name: "Học kỳ 2", startsOn: "2027-01-16", endsOn: "2027-05-31" });
    expect(await schoolYearOverview(db, b.glv, "2026-10-12")).toBeNull();
    const o = await schoolYearOverview(db, b.head, "2026-10-12");
    expect(o?.years.map((y) => y.name)).toEqual(["2026-2027"]);
    expect(o?.years[0].terms.map((t) => t.name)).toEqual(["Học kỳ 1", "Học kỳ 2"]);
    expect(o?.defaults).toEqual(VALID);
    await createSchoolYear(db, b.head, VALID);
    const after = await schoolYearOverview(db, b.head, "2026-10-12");
    expect(after?.years.map((y) => y.name)).toEqual(["2027-2028", "2026-2027"]);
    expect(after?.defaults.name).toBe("2028-2029");
  });
});
