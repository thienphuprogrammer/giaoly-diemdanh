import { describe, expect, it } from "vitest";
import { AUDIT_MIGRATION, createTestDbBeforeMigration } from "./migration";

type Client = Awaited<ReturnType<typeof createTestDbBeforeMigration>>["client"];

async function seedExisting(client: Client) {
  const one = async <T,>(q: string) => (await client.query<T>(q)).rows[0];
  const grade = await one<{ id: string }>(`insert into grades (name, mass_threshold) values ('Khối 1', 3) returning id`);
  const user = await one<{ id: string }>(`insert into users (email, name, password_hash) values ('a@x.vn', 'A', 'x') returning id`);
  const cls = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${grade.id}', 'Lớp A') returning id`);
  await client.query(`insert into students (class_id, full_name) values ('${cls.id}', 'An')`);
  return { gradeId: grade.id, userId: user.id, classId: cls.id };
}

const insertEvent = (cols: Record<string, string | null>) => {
  const keys = Object.keys(cols);
  const vals = keys.map((k) => (cols[k] === null ? "null" : `'${cols[k]}'`));
  return `insert into audit_events (${keys.join(", ")}) values (${vals.join(", ")})`;
};

describe(`migration ${AUDIT_MIGRATION}`, () => {
  it("applies on a database with existing data without touching it and starts empty", async () => {
    const { client, apply } = await createTestDbBeforeMigration(AUDIT_MIGRATION);
    await seedExisting(client);
    await apply();
    expect((await client.query(`select full_name from students`)).rows).toEqual([{ full_name: "An" }]);
    expect((await client.query(`select mass_threshold from grades`)).rows).toEqual([{ mass_threshold: 3 }]);
    expect((await client.query(`select count(*)::int as n from audit_events`)).rows).toEqual([{ n: 0 }]);
    const idx = await client.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'audit_events' order by indexname`);
    expect(idx.rows.map((r) => r.indexname)).toEqual(["audit_events_at_idx", "audit_events_class_at_idx", "audit_events_grade_at_idx", "audit_events_pkey"]);
  });

  it("defaults id/at/summary, restricts entity, requires a class or a grade and an object summary", async () => {
    const { client, apply } = await createTestDbBeforeMigration(AUDIT_MIGRATION);
    const { classId, gradeId, userId } = await seedExisting(client);
    await apply();
    await client.query(insertEvent({ actor_id: userId, class_id: classId, entity: "student", action: "student.create" }));
    const [row] = (await client.query<{ id: string; at: Date; summary: unknown }>(`select id, at, summary from audit_events`)).rows;
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.at).toBeInstanceOf(Date);
    expect(row.summary).toEqual({});
    await client.query(insertEvent({ grade_id: gradeId, entity: "grade_settings", action: "grade.mass_threshold" }));
    await expect(client.query(insertEvent({ class_id: classId, entity: "users", action: "x" }))).rejects.toThrow(/audit_entity/);
    await expect(client.query(insertEvent({ entity: "student", action: "student.create" }))).rejects.toThrow(/audit_events_scope/);
    await expect(client.query(`insert into audit_events (class_id, entity, action, summary) values ('${classId}', 'student', 'x', '[1]')`))
      .rejects.toThrow(/audit_events_summary_object/);
  });

  it("keeps events when the actor is deleted (actor set null) and drops them with their class or grade", async () => {
    const { client, apply } = await createTestDbBeforeMigration(AUDIT_MIGRATION);
    const { classId, gradeId, userId } = await seedExisting(client);
    await apply();
    await client.query(insertEvent({ actor_id: userId, class_id: classId, entity: "student", action: "student.create" }));
    await client.query(insertEvent({ actor_id: userId, grade_id: gradeId, entity: "grade_settings", action: "grade.mass_threshold" }));
    await client.query(`delete from users where id = '${userId}'`);
    expect((await client.query(`select actor_id from audit_events`)).rows).toEqual([{ actor_id: null }, { actor_id: null }]);
    await client.query(`delete from classes where id = '${classId}'`);
    expect((await client.query(`select action from audit_events`)).rows).toEqual([{ action: "grade.mass_threshold" }]);
    await client.query(`delete from grades where id = '${gradeId}'`);
    expect((await client.query(`select count(*)::int as n from audit_events`)).rows).toEqual([{ n: 0 }]);
  });
});
