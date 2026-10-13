import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_ANNUAL_CLASSES_MIGRATION, createTestDbBeforeMigration } from "./migration";

type MigrationDb = Awaited<ReturnType<typeof createTestDbBeforeMigration>>;
const opened: MigrationDb[] = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map(({ client }) => client.close()));
});

async function setup() {
  const m = await createTestDbBeforeMigration(ADMIN_ANNUAL_CLASSES_MIGRATION);
  opened.push(m);
  const one = async <T,>(sql: string, params: unknown[] = []) => (await m.client.query<T>(sql, params)).rows[0];
  const grade = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const year = async (name: string) => (await one<{ id: string }>(`insert into school_years (name) values ($1) returning id`, [name])).id;
  const term = async (yearId: string, startsOn = "2025-09-01", endsOn = "2026-01-31") => (await one<{ id: string }>(
    `insert into terms (school_year_id, name, starts_on, ends_on) values ($1, 'Học kỳ', $2, $3) returning id`,
    [yearId, startsOn, endsOn],
  )).id;
  const cls = async (name: string) => (await one<{ id: string }>(`insert into classes (grade_id, name) values ($1, $2) returning id`, [grade.id, name])).id;
  const student = async (classId: string, name: string) => (await one<{ id: string }>(`insert into students (class_id, full_name) values ($1, $2) returning id`, [classId, name])).id;
  const session = async (classId: string, termId: string, date = "2025-10-01") => (await one<{ id: string }>(
    `insert into sessions (class_id, term_id, held_on) values ($1, $2, $3) returning id`, [classId, termId, date],
  )).id;
  return { ...m, one, gradeId: grade.id, year, term, cls, student, session };
}

describe(`migration ${ADMIN_ANNUAL_CLASSES_MIGRATION}`, () => {
  it("assigns a legacy class to its session year and preserves its IDs, students, teachers and attendance", async () => {
    const m = await setup();
    const yearId = await m.year("2025-2026");
    const termId = await m.term(yearId);
    const classId = await m.cls("Lớp A");
    const studentId = await m.student(classId, "An");
    const sessionId = await m.session(classId, termId);
    const user = await m.one<{ id: string }>(`insert into users (email, name, password_hash) values ('a@x.vn', 'A', 'hash') returning id`);
    await m.client.query(`insert into class_catechists values ($1, $2)`, [classId, user.id]);
    await m.client.query(`insert into attendance (session_id, student_id, status) values ($1, $2, 'present')`, [sessionId, studentId]);
    await m.apply();
    expect((await m.client.query(`select id, school_year_id from classes`)).rows).toEqual([{ id: classId, school_year_id: yearId }]);
    expect((await m.client.query(`select id, class_id from students`)).rows).toEqual([{ id: studentId, class_id: classId }]);
    expect((await m.client.query(`select * from class_catechists`)).rows).toEqual([{ class_id: classId, user_id: user.id }]);
    expect((await m.client.query(`select session_id, student_id, status from attendance`)).rows).toEqual([{ session_id: sessionId, student_id: studentId, status: "present" }]);
  });

  it("assigns an unmarked class to the active year, even when another year starts later", async () => {
    const m = await setup();
    const activeYear = await m.year("Hiện tại");
    const futureYear = await m.year("Tương lai");
    await m.client.query(`insert into terms (school_year_id, name, starts_on, ends_on) values ($1, 'Hiện tại', CURRENT_DATE - 20, CURRENT_DATE + 20), ($2, 'Tương lai', CURRENT_DATE + 100, CURRENT_DATE + 200)`, [activeYear, futureYear]);
    const classId = await m.cls("Chưa điểm danh");
    await m.apply();
    expect(await m.one(`select school_year_id from classes where id = $1`, [classId])).toEqual({ school_year_id: activeYear });
    const added = await m.cls("Lớp mới chưa truyền niên khóa");
    expect(await m.one(`select school_year_id from classes where id = $1`, [added])).toEqual({ school_year_id: activeYear });
  });

  it("falls back to the latest started year when no term is active", async () => {
    const m = await setup();
    const oldYear = await m.year("Cũ");
    const recentYear = await m.year("Gần nhất");
    const futureYear = await m.year("Sắp tới");
    await m.client.query(`insert into terms (school_year_id, name, starts_on, ends_on) values ($1, 'Cũ', CURRENT_DATE - 500, CURRENT_DATE - 300), ($2, 'Gần nhất', CURRENT_DATE - 200, CURRENT_DATE - 100), ($3, 'Sắp tới', CURRENT_DATE + 10, CURRENT_DATE + 50)`, [oldYear, recentYear, futureYear]);
    const classId = await m.cls("Lớp A");
    await m.apply();
    expect(await m.one(`select school_year_id from classes where id = $1`, [classId])).toEqual({ school_year_id: recentYear });
  });

  it("uses the nearest future year when all dated years are ahead", async () => {
    const m = await setup();
    const near = await m.year("Gần");
    const far = await m.year("Xa");
    await m.client.query(`insert into terms (school_year_id, name, starts_on, ends_on) values ($1, 'Gần', CURRENT_DATE + 10, CURRENT_DATE + 50), ($2, 'Xa', CURRENT_DATE + 100, CURRENT_DATE + 200)`, [near, far]);
    const classId = await m.cls("Lớp A");
    await m.apply();
    expect(await m.one(`select school_year_id from classes where id = $1`, [classId])).toEqual({ school_year_id: near });
  });

  it("uses an existing year without terms for an unassigned legacy class", async () => {
    const m = await setup();
    const yearId = await m.year("2026-2027");
    const classId = await m.cls("Lớp A");
    await m.apply();
    expect(await m.one(`select school_year_id from classes where id = $1`, [classId])).toEqual({ school_year_id: yearId });
    expect((await m.client.query(`select name from school_years`)).rows).toEqual([{ name: "2026-2027" }]);
  });

  it("creates exactly one labeled legacy year only when old classes have no available year", async () => {
    const m = await setup();
    await m.cls("Lớp A");
    await m.cls("Lớp B");
    await m.apply();
    expect((await m.client.query(`select name from school_years`)).rows).toEqual([{ name: "Dữ liệu cũ" }]);
    expect(await m.one(`select count(distinct school_year_id)::int as count from classes`)).toEqual({ count: 1 });
  });

  it("does not add a phantom year on a fresh empty database", async () => {
    const m = await setup();
    await m.apply();
    expect((await m.client.query(`select * from school_years`)).rows).toEqual([]);
    await expect(m.cls("Cần niên khóa trước")).rejects.toThrow(/school_year_id/);
  });

  it("aborts clearly before changing data or schema when a legacy class contains sessions from multiple years", async () => {
    const m = await setup();
    const firstYear = await m.year("2025-2026");
    const secondYear = await m.year("2026-2027");
    const firstTerm = await m.term(firstYear);
    const secondTerm = await m.term(secondYear, "2026-09-01", "2027-01-31");
    const classId = await m.cls("Lớp nhiều năm");
    const studentId = await m.student(classId, "An");
    await m.session(classId, firstTerm);
    await m.session(classId, secondTerm, "2026-10-01");
    const before = (await m.client.query(`select * from classes`)).rows;
    await expect(m.apply()).rejects.toThrow(/nhiều niên khóa/);
    expect((await m.client.query(`select * from classes`)).rows).toEqual(before);
    expect((await m.client.query(`select id, class_id from students`)).rows).toEqual([{ id: studentId, class_id: classId }]);
    expect(await m.one(`select count(*)::int as count from sessions`)).toEqual({ count: 2 });
    expect(await m.one(`select count(*)::int as count from school_years`)).toEqual({ count: 2 });
    expect((await m.client.query(`select column_name from information_schema.columns where table_name = 'users' and column_name = 'is_admin'`)).rows).toEqual([]);
  });

  it("allows the same class name in different years but rejects duplicates within one grade and year", async () => {
    const m = await setup();
    const firstYear = await m.year("2025-2026");
    const secondYear = await m.year("2026-2027");
    await m.apply();
    const insert = (yearId: string) => m.client.query(`insert into classes (grade_id, school_year_id, name) values ($1, $2, 'Lớp A')`, [m.gradeId, yearId]);
    await insert(firstYear);
    await insert(secondYear);
    await expect(insert(firstYear)).rejects.toThrow(/classes_grade_year_name_uq/);
  });

  it("backfills every current student plus historical attendees after a class transfer", async () => {
    const m = await setup();
    const yearId = await m.year("2025-2026");
    const termId = await m.term(yearId);
    const oldClass = await m.cls("Cũ");
    const newClass = await m.cls("Mới");
    const marked = await m.student(oldClass, "Có điểm danh");
    const unmarked = await m.student(oldClass, "Chưa điểm danh");
    const sessionId = await m.session(oldClass, termId);
    await m.client.query(`insert into attendance (session_id, student_id, status) values ($1, $2, 'present')`, [sessionId, marked]);
    await m.client.query(`update students set class_id = $1 where id = $2`, [newClass, marked]);
    await m.apply();
    const memberships = (await m.client.query(`select class_id, student_id from class_memberships`)).rows;
    expect(memberships).toHaveLength(3);
    expect(memberships).toEqual(expect.arrayContaining([
      { class_id: oldClass, student_id: marked }, { class_id: oldClass, student_id: unmarked }, { class_id: newClass, student_id: marked },
    ]));
  });

  it("keeps the old and new membership automatically when an unmarked child is moved, without duplicates", async () => {
    const m = await setup();
    await m.year("2025-2026");
    await m.apply();
    const oldClass = await m.cls("Cũ");
    const newClass = await m.cls("Mới");
    const studentId = await m.student(oldClass, "An");
    await m.client.query(`update students set class_id = $1 where id = $2`, [newClass, studentId]);
    await m.client.query(`update students set class_id = $1 where id = $2`, [oldClass, studentId]);
    expect((await m.client.query(`select class_id, student_id from class_memberships`)).rows).toEqual(expect.arrayContaining([
      { class_id: oldClass, student_id: studentId }, { class_id: newClass, student_id: studentId },
    ]));
    expect(await m.one(`select count(*)::int as count from class_memberships`)).toEqual({ count: 2 });
    await m.client.query(`delete from students where id = $1`, [studentId]);
    expect((await m.client.query(`select * from class_memberships`)).rows).toEqual([]);
  });

  it("prevents deleting a year that still owns a class", async () => {
    const m = await setup();
    const yearId = await m.year("2025-2026");
    await m.cls("Lớp A");
    await m.apply();
    await expect(m.client.query(`delete from school_years where id = $1`, [yearId])).rejects.toThrow(/classes_school_year_id_school_years_id_fk/);
    await expect(m.client.query(`insert into classes (grade_id, school_year_id, name) values ($1, $2, 'Sai năm')`, [m.gradeId, crypto.randomUUID()])).rejects.toThrow(/classes_school_year_id_school_years_id_fk/);
  });

  it("keeps existing accounts active and non-admin by default and allows explicit administrator accounts", async () => {
    const m = await setup();
    await m.client.query(`insert into users (email, name, password_hash) values ('old@x.vn', 'Cũ', 'old-hash')`);
    await m.apply();
    await m.client.query(`insert into users (email, name, password_hash, is_admin) values ('admin@x.vn', 'Admin', 'new-hash', true)`);
    expect((await m.client.query(`select email, password_hash, is_admin, is_active from users order by email`)).rows).toEqual([
      { email: "admin@x.vn", password_hash: "new-hash", is_admin: true, is_active: true },
      { email: "old@x.vn", password_hash: "old-hash", is_admin: false, is_active: true },
    ]);
    await expect(m.client.query(`update users set is_active = null`)).rejects.toThrow(/is_active/);
  });

  it("starts legacy and newly created accounts at session version zero and rejects invalid revocation versions", async () => {
    const m = await setup();
    await m.client.query(`insert into users (email, name, password_hash) values ('old@x.vn', 'Cũ', 'old-hash')`);
    await m.apply();
    await m.client.query(`insert into users (email, name, password_hash) values ('new@x.vn', 'Mới', 'new-hash')`);
    expect((await m.client.query(`select email, password_hash, session_version from users order by email`)).rows).toEqual([
      { email: "new@x.vn", password_hash: "new-hash", session_version: 0 },
      { email: "old@x.vn", password_hash: "old-hash", session_version: 0 },
    ]);
    await m.client.query(`update users set session_version = session_version + 1 where email = 'old@x.vn'`);
    expect(await m.one(`select session_version from users where email = 'old@x.vn'`)).toEqual({ session_version: 1 });
    await expect(m.client.query(`update users set session_version = -1`)).rejects.toThrow(/users_session_version_nonnegative/);
    await expect(m.client.query(`update users set session_version = null`)).rejects.toThrow(/session_version/);
  });

  it("keeps legacy promotions unchanged with unknown new memberships and stores membership IDs for new undo tracking", async () => {
    const m = await setup();
    await m.year("2025-2026");
    const fromClass = await m.cls("Nguồn");
    const toClass = await m.cls("Đích");
    const studentId = await m.student(fromClass, "An");
    const promotion = await m.one<{ id: string }>(
      `insert into promotions (from_class_id, to_class_id, student_ids) values ($1, $2, array[$3]::uuid[]) returning id`,
      [fromClass, toClass, studentId],
    );
    await m.apply();
    expect(await m.one(`select id, from_class_id, to_class_id, student_ids, new_membership_student_ids from promotions where id = $1`, [promotion.id])).toEqual({
      id: promotion.id, from_class_id: fromClass, to_class_id: toClass, student_ids: [studentId], new_membership_student_ids: null,
    });
    const newPromotion = await m.one<{ id: string }>(
      `insert into promotions (from_class_id, to_class_id, student_ids, new_membership_student_ids) values ($1, $2, array[$3]::uuid[], array[$3]::uuid[]) returning id`,
      [fromClass, toClass, studentId],
    );
    expect(await m.one(`select new_membership_student_ids from promotions where id = $1`, [newPromotion.id])).toEqual({ new_membership_student_ids: [studentId] });
    await m.client.query(`update promotions set new_membership_student_ids = '{}' where id = $1`, [newPromotion.id]);
    expect(await m.one(`select new_membership_student_ids from promotions where id = $1`, [newPromotion.id])).toEqual({ new_membership_student_ids: [] });
  });

  it("permits global audit scope only for accounts, grades and school years", async () => {
    const m = await setup();
    await m.apply();
    for (const entity of ["account", "grade", "school_year"]) {
      await m.client.query(`insert into audit_events (entity, action) values ($1, $2)`, [entity, `${entity}.create`]);
    }
    for (const entity of ["attendance", "student", "seating_plan", "session", "grade_settings", "promotion", "class"]) {
      await expect(m.client.query(`insert into audit_events (entity, action) values ($1, $2)`, [entity, `${entity}.update`])).rejects.toThrow(/audit_events_scope/);
    }
    await m.client.query(`insert into audit_events (grade_id, entity, action) values ($1, 'class', 'class.create')`, [m.gradeId]);
    expect(await m.one(`select count(*)::int as count from audit_events`)).toEqual({ count: 4 });
  });
});
