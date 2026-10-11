import { describe, expect, it } from "vitest";
import { students } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { addStudent, importStudents, setStudentActive, updateStudent } from "./students";

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

describe("updateStudent denial", () => {
  it("leaves a real student of another class unchanged for a read-only head and a foreign catechist", async () => {
    const { db, b } = await setup();
    const added = await addStudent(db, b.glv, { classId: b.classId, fullName: "An", saintName: "Phêrô", note: "ghi chú" });
    if (!added.ok) throw new Error("setup");
    const [before] = await db.select().from(students);
    const patch = { studentId: added.data.id, fullName: "Bị sửa", saintName: "", note: "" };
    const a = await updateStudent(db, b.head, patch);
    const c = await updateStudent(db, b.otherGlv, patch);
    expect(a).toEqual({ ok: false, error: "Không tìm thấy thiếu nhi" });
    expect(c).toEqual(a);
    const [after] = await db.select().from(students);
    expect(after).toEqual(before);
  });
});

describe("importStudents", () => {
  it("inserts valid rows and skips students already in the class", async () => {
    const { db, b } = await setup();
    await addStudent(db, b.glv, { classId: b.classId, fullName: "An", birthDate: "2015-01-01" });
    const r = await importStudents(db, b.glv, {
      classId: b.classId,
      rows: [{ fullName: "An", birthDate: "2015-01-01" }, { fullName: "Bình" }, { fullName: "Chi", parentPhone: "0901234567" }],
    });
    expect(r).toEqual({ ok: true, data: { inserted: 2, skipped: 1 } });
    expect(await db.select().from(students)).toHaveLength(3);
  });

  it("re-validates rows on the server", async () => {
    const { db, b } = await setup();
    expect((await importStudents(db, b.glv, { classId: b.classId, rows: [{ fullName: "" }] })).ok).toBe(false);
    expect(await db.select().from(students)).toHaveLength(0);
  });

  it("rejects more than the row limit and unauthorised callers", async () => {
    const { db, b } = await setup();
    const many = Array.from({ length: 501 }, (_, i) => ({ fullName: `Em ${i}` }));
    expect((await importStudents(db, b.glv, { classId: b.classId, rows: many })).ok).toBe(false);
    expect((await importStudents(db, b.otherGlv, { classId: b.classId, rows: [{ fullName: "X" }] })).ok).toBe(false);
  });

  it("inserts duplicate rows inside one payload once", async () => {
    const { db, b } = await setup();
    const r = await importStudents(db, b.glv, { classId: b.classId, rows: [{ fullName: "An" }, { fullName: " an " }] });
    expect(r).toEqual({ ok: true, data: { inserted: 1, skipped: 1 } });
    expect(await db.select().from(students)).toHaveLength(1);
  });

  it("matches existing students regardless of Unicode normalisation form", async () => {
    const { db, b } = await setup();
    const name = "Nguyễn Văn An";
    await addStudent(db, b.glv, { classId: b.classId, fullName: name.normalize("NFC") });
    await importStudents(db, b.glv, { classId: b.classId, rows: [{ fullName: name.normalize("NFD") }] });
    expect(await db.select().from(students)).toHaveLength(1);
    const { db: db2, b: b2 } = await setup();
    await addStudent(db2, b2.glv, { classId: b2.classId, fullName: name.normalize("NFD") });
    await importStudents(db2, b2.glv, { classId: b2.classId, rows: [{ fullName: name.normalize("NFC") }] });
    expect(await db2.select().from(students)).toHaveLength(1);
  });

  it("leaves one copy of each student for concurrent imports", async () => {
    const { db, b } = await setup();
    const input = { classId: b.classId, rows: [{ fullName: "An" }, { fullName: "Bình" }] };
    await Promise.all([importStudents(db, b.glv, input), importStudents(db, b.glv, input)]);
    expect(await db.select().from(students)).toHaveLength(2);
  });
});
