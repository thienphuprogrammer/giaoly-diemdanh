import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { termById } from "./stats";

describe("termById", () => {
  it("returns the term with that id, null for an unknown or malformed id (no query error)", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    expect(await termById(db, b.termId)).toMatchObject({ id: b.termId, name: "Học kỳ 1", startsOn: "2026-09-01", endsOn: "2027-01-15" });
    expect(await termById(db, crypto.randomUUID())).toBeNull();
    for (const bad of ["", "abc", "1; drop table terms", `${b.termId}x`]) expect(await termById(db, bad)).toBeNull();
  });
});
