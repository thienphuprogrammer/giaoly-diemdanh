import { describe, expect, it } from "vitest";
import { PASSWORD_CHANGED_MIGRATION, createTestDbBeforeMigration } from "./migration";

async function setup() {
  const m = await createTestDbBeforeMigration(PASSWORD_CHANGED_MIGRATION);
  await m.client.query(`insert into users (email, name, password_hash) values ('a@x.vn', 'A', 'h1'), ('b@x.vn', 'B', 'h2')`);
  await m.apply();
  return m;
}

describe(`migration ${PASSWORD_CHANGED_MIGRATION}`, () => {
  it("adds a nullable password_changed_at, leaving existing users untouched (legacy sessions stay valid)", async () => {
    const { client } = await setup();
    const rows = (await client.query(`select email, password_hash, password_changed_at from users order by email`)).rows;
    expect(rows).toEqual([
      { email: "a@x.vn", password_hash: "h1", password_changed_at: null },
      { email: "b@x.vn", password_hash: "h2", password_changed_at: null },
    ]);
  });

  it("stores the column as timestamptz", async () => {
    const { client } = await setup();
    const col = (await client.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns where table_name = 'users' and column_name = 'password_changed_at'`,
    )).rows[0];
    expect(col).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
  });
});
