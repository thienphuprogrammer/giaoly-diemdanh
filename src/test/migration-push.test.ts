import { describe, expect, it } from "vitest";
import { PUSH_MIGRATION, createTestDbBeforeMigration } from "./migration";

async function setup() {
  const m = await createTestDbBeforeMigration(PUSH_MIGRATION);
  const one = async <T,>(q: string) => (await m.client.query<T>(q)).rows[0];
  const g = await one<{ id: string }>(`insert into grades (name) values ('Khối 1') returning id`);
  const c = await one<{ id: string }>(`insert into classes (grade_id, name) values ('${g.id}', 'Lớp A') returning id`);
  const u = await one<{ id: string }>(`insert into users (email, name, password_hash) values ('a@x.vn', 'A', 'x') returning id`);
  const u2 = await one<{ id: string }>(`insert into users (email, name, password_hash) values ('b@x.vn', 'B', 'x') returning id`);
  await m.apply();
  return { ...m, one, gradeId: g.id, classId: c.id, userId: u.id, user2: u2.id };
}

const sub = (userId: string, endpoint: string, ua: string | null = null) =>
  `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ('${userId}', '${endpoint}', 'k', 'a', ${ua === null ? "null" : `'${ua}'`})`;

describe(`migration ${PUSH_MIGRATION}`, () => {
  it("leaves existing classes without a schedule", async () => {
    const { client } = await setup();
    expect((await client.query(`select name, meets_on, meets_at from classes`)).rows).toEqual([{ name: "Lớp A", meets_on: null, meets_at: null }]);
  });

  it("accepts weekdays 0..6 and a time, refuses other weekdays", async () => {
    const { client, classId } = await setup();
    for (const d of [0, 6]) await client.query(`update classes set meets_on = ${d}, meets_at = '08:00' where id = '${classId}'`);
    expect((await client.query(`select meets_on, meets_at from classes`)).rows).toEqual([{ meets_on: 6, meets_at: "08:00:00" }]);
    for (const d of [-1, 7]) await expect(client.query(`update classes set meets_on = ${d} where id = '${classId}'`)).rejects.toThrow(/classes_meets_on_range/);
  });

  it("stores push subscriptions with unique endpoints, defaults and a capped user agent; deleting the user removes them", async () => {
    const { client, one, userId, user2 } = await setup();
    await client.query(sub(userId, "https://fcm.googleapis.com/fcm/send/one", "Safari"));
    await expect(client.query(sub(user2, "https://fcm.googleapis.com/fcm/send/one"))).rejects.toThrow(/push_subscriptions_endpoint_unique/);
    await expect(client.query(sub(userId, "https://fcm.googleapis.com/fcm/send/two", "x".repeat(201)))).rejects.toThrow(/push_subscriptions_user_agent_len/);
    const row = await one<Record<string, unknown>>(`select failure_count, last_ok_at, created_at is not null as has_created from push_subscriptions`);
    expect(row).toEqual({ failure_count: 0, last_ok_at: null, has_created: true });
    await client.query(`delete from users where id = '${userId}'`);
    expect((await client.query(`select count(*)::int as n from push_subscriptions`)).rows).toEqual([{ n: 0 }]);
  });

  it("keeps notification_log idempotent per (kind, target, user)", async () => {
    const { client, userId } = await setup();
    const ins = () => client.query(`insert into notification_log (kind, target_key, user_id) values ('class_open', 'c:2026-10-12', '${userId}')`);
    await ins();
    await expect(ins()).rejects.toThrow(/notification_log_kind_target_user_uq/);
    const rows = (await client.query(`insert into notification_log (kind, target_key, user_id) values ('class_open', 'c:2026-10-12', '${userId}') on conflict do nothing returning id`)).rows;
    expect(rows).toEqual([]);
  });

  it("accepts the new audit entity for class schedule edits", async () => {
    const { client, classId } = await setup();
    await client.query(`insert into audit_events (class_id, entity, action) values ('${classId}', 'class', 'class.schedule')`);
    expect((await client.query(`select entity, action from audit_events`)).rows).toEqual([{ entity: "class", action: "class.schedule" }]);
  });
});
