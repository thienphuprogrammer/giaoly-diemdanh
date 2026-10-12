import { describe, expect, it } from "vitest";
import { PUSH_FIX_MIGRATION, createTestDbBeforeMigration } from "./migration";

async function setup() {
  const m = await createTestDbBeforeMigration(PUSH_FIX_MIGRATION);
  const one = async <T,>(q: string) => (await m.client.query<T>(q)).rows[0];
  const g = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const ins = (name: string, on: string, at: string) => one<{ id: string }>(`insert into classes (grade_id, name, meets_on, meets_at) values ('${g.id}', '${name}', ${on}, ${at}) returning id`);
  const full = await ins("Đủ", "0", "'08:00'");
  const none = await ins("Trống", "null", "null");
  const dayOnly = await ins("Chỉ thứ", "3", "null");
  const timeOnly = await ins("Chỉ giờ", "null", "'09:00'");
  const u = await one<{ id: string }>(`insert into users (email, name, password_hash) values ('a@x.vn', 'A', 'x') returning id`);
  await m.client.query(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('${u.id}', 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a')`);
  await m.apply();
  return { ...m, gradeId: g.id, ids: { full: full.id, none: none.id, dayOnly: dayOnly.id, timeOnly: timeOnly.id } };
}

describe(`migration ${PUSH_FIX_MIGRATION}`, () => {
  it("keeps complete and empty schedules and clears half-set ones (safe on existing rows)", async () => {
    const { client } = await setup();
    const rows = (await client.query(`select name, meets_on, meets_at from classes order by name`)).rows;
    expect(rows).toEqual([
      { name: "Chỉ giờ", meets_on: null, meets_at: null },
      { name: "Chỉ thứ", meets_on: null, meets_at: null },
      { name: "Trống", meets_on: null, meets_at: null },
      { name: "Đủ", meets_on: 0, meets_at: "08:00:00" },
    ]);
  });

  it("refuses a half-set schedule afterwards", async () => {
    const { client, ids } = await setup();
    await expect(client.query(`update classes set meets_at = null where id = '${ids.full}'`)).rejects.toThrow(/classes_schedule_both_or_neither/);
    await expect(client.query(`update classes set meets_on = 2 where id = '${ids.none}'`)).rejects.toThrow(/classes_schedule_both_or_neither/);
    await client.query(`update classes set meets_on = 2, meets_at = '10:00' where id = '${ids.none}'`);
  });

  it("adds auth_failure_count defaulting to 0 on existing subscriptions", async () => {
    const { client } = await setup();
    expect((await client.query(`select failure_count, auth_failure_count from push_subscriptions`)).rows).toEqual([{ failure_count: 0, auth_failure_count: 0 }]);
  });
});
