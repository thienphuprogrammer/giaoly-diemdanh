import { describe, expect, it } from "vitest";
import { MASS_MIGRATION, createTestDbBeforeMigration } from "./migration";

type Client = Awaited<ReturnType<typeof createTestDbBeforeMigration>>["client"];

/** Dữ liệu "cũ" tạo bằng SQL thô vì schema TypeScript đã có cột mới. */
async function seedLegacy(client: Client) {
  const one = async <T,>(q: string) => (await client.query<T>(q)).rows[0];
  const grade = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const year = await one<{ id: string }>(`insert into school_years (name) values ('2026-2027') returning id`);
  const term = await one<{ id: string }>(
    `insert into terms (school_year_id, name, starts_on, ends_on) values ('${year.id}', 'HK1', '2026-09-01', '2027-01-15') returning id`);
  const cls = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${grade.id}', 'Lớp A') returning id`);
  await client.query(`insert into sessions (class_id, term_id, held_on) values ('${cls.id}', '${term.id}', '2026-10-10'), ('${cls.id}', '${term.id}', '2026-10-17')`);
  return { classId: cls.id, termId: term.id };
}

describe(`migration ${MASS_MIGRATION}`, () => {
  it("backfills existing sessions as 'class' and grades with a mass threshold of 2", async () => {
    const { client, apply } = await createTestDbBeforeMigration(MASS_MIGRATION);
    await seedLegacy(client);
    await apply();
    const kinds = await client.query<{ kind: string }>(`select kind::text as kind from sessions`);
    expect(kinds.rows.map((r) => r.kind)).toEqual(["class", "class"]);
    const grades = await client.query<{ t: number }>(`select mass_threshold as t from grades`);
    expect(grades.rows).toEqual([{ t: 2 }]);
  });

  it("keeps one class session per class and day, but allows a mass session on the same day", async () => {
    const { client, apply } = await createTestDbBeforeMigration(MASS_MIGRATION);
    const { classId, termId } = await seedLegacy(client);
    await apply();
    await expect(client.query(`insert into sessions (class_id, term_id, held_on) values ('${classId}', '${termId}', '2026-10-10')`))
      .rejects.toThrow(/sessions_class_date_kind_uq/);
    await expect(client.query(`insert into sessions (class_id, term_id, held_on, kind) values ('${classId}', '${termId}', '2026-10-10', 'class')`))
      .rejects.toThrow(/duplicate key/);
    await client.query(`insert into sessions (class_id, term_id, held_on, kind) values ('${classId}', '${termId}', '2026-10-10', 'mass')`);
    await expect(client.query(`insert into sessions (class_id, term_id, held_on, kind) values ('${classId}', '${termId}', '2026-10-10', 'mass')`))
      .rejects.toThrow(/duplicate key/);
    await expect(client.query(`insert into sessions (class_id, term_id, held_on, kind) values ('${classId}', '${termId}', '2026-10-11', 'other')`))
      .rejects.toThrow();
    const n = await client.query<{ n: number }>(`select count(*)::int as n from sessions`);
    expect(n.rows[0].n).toBe(3);
  });
});
