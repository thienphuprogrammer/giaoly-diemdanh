import { describe, expect, it } from "vitest";
import { sessions, students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { loadBoardData } from "./attendance";
import { getStudent, listStudents } from "./students";
import { rosterOf } from "./stats";

describe("student queries never expose qrToken", () => {
  it("listStudents, getStudent, rosterOf and loadBoardData omit the token", async () => {
    const db = await createTestDb();
    const b = await seedBasics(db);
    const [kid] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
    const [session] = await db.insert(sessions).values({ classId: b.classId, termId: b.termId, heldOn: "2026-10-11" }).returning();

    expect(Object.keys((await listStudents(db, b.classId))[0])).not.toContain("qrToken");
    expect(Object.keys((await getStudent(db, kid.id))!)).not.toContain("qrToken");
    expect(Object.keys((await rosterOf(db, [b.classId]))[0])).not.toContain("qrToken");
    const board = await loadBoardData(db, session);
    expect(JSON.stringify(board)).not.toContain(kid.qrToken);
  });
});
