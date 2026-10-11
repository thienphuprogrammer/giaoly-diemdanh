import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { addStudent, setStudentActive, updateStudent } from "./students";

async function setup() {
  const db = await createTestDb();
  return { db, b: await seedBasics(db) };
}

describe("addStudent", () => {
  it("adds a student for an assigned catechist", async () => {
    const { db, b } = await setup();
    const r = await addStudent(db, b.glv, { classId: b.classId, fullName: "  Nguyễn Văn An ", saintName: "Phêrô", parentPhone: "0901 234 567" });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ fullName: "Nguyễn Văn An", saintName: "Phêrô", active: true });
  });

  it("treats empty optional fields as null", async () => {
    const { db, b } = await setup();
    await addStudent(db, b.glv, { classId: b.classId, fullName: "An", saintName: "", birthDate: "", parentPhone: "", note: "" });
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ saintName: null, birthDate: null, parentPhone: null, note: null });
  });

  it("rejects a missing name with a Vietnamese message", async () => {
    const { db, b } = await setup();
    expect(await addStudent(db, b.glv, { classId: b.classId, fullName: "  " })).toEqual({ ok: false, error: "Nhập họ tên" });
  });

  it("rejects an invalid phone or date", async () => {
    const { db, b } = await setup();
    expect((await addStudent(db, b.glv, { classId: b.classId, fullName: "An", parentPhone: "abc" })).ok).toBe(false);
    expect((await addStudent(db, b.glv, { classId: b.classId, fullName: "An", birthDate: "31/02/2015" })).ok).toBe(false);
  });

  it("is forbidden for a catechist of another class and for a read-only grade head", async () => {
    const { db, b } = await setup();
    expect((await addStudent(db, b.otherGlv, { classId: b.classId, fullName: "An" })).ok).toBe(false);
    expect((await addStudent(db, b.head, { classId: b.classId, fullName: "An" })).ok).toBe(false);
    expect(await db.select().from(students)).toHaveLength(0);
  });
});

describe("updateStudent / setStudentActive", () => {
  it("updates fields and hides a student without deleting", async () => {
    const { db, b } = await setup();
    const added = await addStudent(db, b.glv, { classId: b.classId, fullName: "An", saintName: "Phêrô" });
    if (!added.ok) throw new Error("setup");
    expect((await updateStudent(db, b.glv, { studentId: added.data.id, fullName: "An Nguyễn", saintName: "" })).ok).toBe(true);
    expect((await setStudentActive(db, b.glv, { studentId: added.data.id, active: false })).ok).toBe(true);
    const [row] = await db.select().from(students);
    expect(row).toMatchObject({ fullName: "An Nguyễn", saintName: null, active: false }); // trường để trống được xóa
  });

  it("cannot touch a student of a class the user cannot write", async () => {
    const { db, b } = await setup();
    const added = await addStudent(db, b.glv, { classId: b.classId, fullName: "An" });
    if (!added.ok) throw new Error("setup");
    expect((await setStudentActive(db, b.otherGlv, { studentId: added.data.id, active: false })).ok).toBe(false);
    expect((await updateStudent(db, b.otherGlv, { studentId: "not-a-uuid", fullName: "X" })).ok).toBe(false);
  });
});
