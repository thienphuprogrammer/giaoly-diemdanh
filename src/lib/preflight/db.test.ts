import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { appliedMigrationCount, journalCount } from "./db";

const runOn = (client: PGlite) => async (q: string) => (await client.query(q)).rows;

describe("journalCount", () => {
  it("đếm entries", () => expect(journalCount(JSON.stringify({ entries: [{ tag: "a" }, { tag: "b" }] }))).toBe(2));
  it("journal hỏng thì ném lỗi rõ", () => {
    expect(() => journalCount("{}")).toThrow(/journal/i);
    expect(() => journalCount("not json")).toThrow(/journal/i);
  });
  it("khớp journal thật của dự án", async () => {
    const { readFileSync } = await import("node:fs");
    expect(journalCount(readFileSync("./drizzle/meta/_journal.json", "utf8"))).toBeGreaterThanOrEqual(5);
  });
});

describe("appliedMigrationCount", () => {
  it("DB trống (chưa có bảng migration) thì 0", async () => {
    const client = new PGlite();
    expect(await appliedMigrationCount(runOn(client))).toBe(0);
  });
  it("đếm số dòng trong drizzle.__drizzle_migrations", async () => {
    const client = new PGlite();
    await client.exec(`create schema drizzle; create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);`);
    await client.exec(`insert into drizzle.__drizzle_migrations (hash, created_at) values ('a', 1), ('b', 2), ('c', 3);`);
    expect(await appliedMigrationCount(runOn(client))).toBe(3);
  });
  it("lỗi khác (ví dụ mất kết nối) được ném lại, không coi là 0", async () => {
    await expect(appliedMigrationCount(async () => { throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" }); })).rejects.toThrow("boom");
  });
});
