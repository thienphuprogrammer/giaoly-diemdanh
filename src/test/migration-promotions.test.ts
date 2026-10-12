import { describe, expect, it } from "vitest";
import { PROMOTIONS_MIGRATION, createTestDbBeforeMigration } from "./migration";

async function setup() {
  const m = await createTestDbBeforeMigration(PROMOTIONS_MIGRATION);
  const one = async <T,>(q: string) => (await m.client.query<T>(q)).rows[0];
  const g1 = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const g2 = await one<{ id: string }>(`insert into grades (name, mass_threshold) values ('Khối 2', 3) returning id`);
  const c1 = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${g1.id}', 'Lớp A') returning id`);
  await m.apply();
  return { ...m, one, g1: g1.id, g2: g2.id, c1: c1.id };
}

describe(`migration ${PROMOTIONS_MIGRATION}`, () => {
  it("keeps existing grades with no next grade and their thresholds", async () => {
    const { client } = await setup();
    const rows = (await client.query(`select name, mass_threshold, next_grade_id from grades order by name`)).rows;
    expect(rows).toEqual([
      { name: "Khối 1", mass_threshold: 2, next_grade_id: null },
      { name: "Khối 2", mass_threshold: 3, next_grade_id: null },
    ]);
  });

  it("lets a grade point to another grade but never to itself, and clears the link when the target is deleted", async () => {
    const { client, g1, g2 } = await setup();
    await client.query(`update grades set next_grade_id = '${g2}' where id = '${g1}'`);
    await expect(client.query(`update grades set next_grade_id = id where id = '${g2}'`)).rejects.toThrow(/grades_next_grade_not_self/);
    await client.query(`delete from grades where id = '${g2}'`);
    expect((await client.query(`select next_grade_id from grades where id = '${g1}'`)).rows).toEqual([{ next_grade_id: null }]);
  });

  it("accepts the new audit entities", async () => {
    const { client, g1 } = await setup();
    await client.query(`insert into audit_events (grade_id, entity, action) values ('${g1}', 'school_year', 'school_year.create')`);
    await client.query(`insert into audit_events (grade_id, entity, action) values ('${g1}', 'promotion', 'promotion.apply')`);
    expect((await client.query(`select entity from audit_events order by entity`)).rows).toEqual([{ entity: "school_year" }, { entity: "promotion" }]);
  });

  it("creates promotions with distinct classes and one row per (actor, client token)", async () => {
    const { client, one, g1, c1 } = await setup();
    const c2 = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${g1}', 'Lớp B') returning id`);
    const u = await one<{ id: string }>(`insert into users (email, name, password_hash) values ('h@x.vn', 'H', 'x') returning id`);
    const ins = (token: string | null, to = c2.id) =>
      client.query(`insert into promotions (actor_id, from_class_id, to_class_id, student_ids, client_token) values ('${u.id}', '${c1}', '${to}', '{}', ${token === null ? "null" : `'${token}'`})`);
    const clientRef = crypto.randomUUID();
    await ins(clientRef);
    await expect(ins(clientRef)).rejects.toThrow(/promotions_actor_client_token_uq/);
    await ins(null);
    await ins(null);
    await expect(ins(null, c1)).rejects.toThrow(/promotions_distinct_classes/);
    const row = await one<{ removed_seats: unknown; undone_at: unknown }>(`select removed_seats, undone_at from promotions limit 1`);
    expect(row).toEqual({ removed_seats: [], undone_at: null });
  });
});
