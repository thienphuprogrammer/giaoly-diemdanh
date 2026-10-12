import { describe, expect, it } from "vitest";
import { MASS_THRESHOLD_MIGRATION, createTestDbBeforeMigration } from "./migration";

describe(`migration ${MASS_THRESHOLD_MIGRATION}`, () => {
  it("keeps existing thresholds (default 2 and custom values) and then refuses a threshold below 1", async () => {
    const { client, apply } = await createTestDbBeforeMigration(MASS_THRESHOLD_MIGRATION);
    await client.query(`insert into grades (name) values ('Khối 1')`);
    await client.query(`insert into grades (name, mass_threshold) values ('Khối 2', 5)`);
    await apply();
    const rows = await client.query<{ name: string; t: number }>(`select name, mass_threshold as t from grades order by name`);
    expect(rows.rows).toEqual([{ name: "Khối 1", t: 2 }, { name: "Khối 2", t: 5 }]);
    await expect(client.query(`update grades set mass_threshold = 0 where name = 'Khối 1'`)).rejects.toThrow(/grades_mass_threshold_min/);
    await expect(client.query(`insert into grades (name, mass_threshold) values ('Khối 3', -1)`)).rejects.toThrow(/grades_mass_threshold_min/);
    await client.query(`update grades set mass_threshold = 1 where name = 'Khối 1'`);
  });
});
