import { describe, expect, it } from "vitest";
import { AUDIT_KEYSET_MIGRATION, createTestDbBeforeMigration } from "./migration";

async function seed(client: Awaited<ReturnType<typeof createTestDbBeforeMigration>>["client"]) {
  const one = async <T,>(q: string) => (await client.query<T>(q)).rows[0];
  const grade = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const cls = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${grade.id}', 'Lớp A') returning id`);
  await client.query(`insert into audit_events (class_id, entity, action) values ('${cls.id}', 'student', 'student.create')`);
  return { classId: cls.id, gradeId: grade.id };
}

describe(`migration ${AUDIT_KEYSET_MIGRATION}`, () => {
  it("keeps existing rows, swaps the scope indexes for (scope, at desc, id) and keeps the retention index", async () => {
    const { client, apply } = await createTestDbBeforeMigration(AUDIT_KEYSET_MIGRATION);
    await seed(client);
    await apply();
    expect((await client.query(`select action from audit_events`)).rows).toEqual([{ action: "student.create" }]);
    const idx = await client.query<{ indexname: string; indexdef: string }>(`select indexname, indexdef from pg_indexes where tablename = 'audit_events' order by indexname`);
    expect(idx.rows.map((r) => r.indexname)).toEqual(["audit_events_at_idx", "audit_events_class_at_idx", "audit_events_grade_at_idx", "audit_events_pkey"]);
    const def = (name: string) => idx.rows.find((r) => r.indexname === name)?.indexdef ?? "";
    expect(def("audit_events_class_at_idx")).toMatch(/\(class_id, at DESC NULLS LAST, id DESC NULLS LAST\)/);
    expect(def("audit_events_grade_at_idx")).toMatch(/\(grade_id, at DESC NULLS LAST, id DESC NULLS LAST\)/);
  });

  it("requires the action to look like entity.verb", async () => {
    const { client, apply } = await createTestDbBeforeMigration(AUDIT_KEYSET_MIGRATION);
    const { classId } = await seed(client);
    await apply();
    const insert = (action: string) => client.query(`insert into audit_events (class_id, entity, action) values ('${classId}', 'student', '${action}')`);
    await insert("student.qr_rotate");
    for (const bad of ["x", "Student.create", "student.create.x", "student create", "student.", ".create", "student.create2", ""]) {
      await expect(insert(bad), bad).rejects.toThrow(/audit_events_action_format/);
    }
  });
});
