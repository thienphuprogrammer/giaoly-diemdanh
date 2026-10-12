import { describe, expect, it } from "vitest";
import { QR_MIGRATION, createTestDbBeforeMigration } from "./migration";

const hasTable = async (client: Awaited<ReturnType<typeof createTestDbBeforeMigration>>["client"], name: string) =>
  (await client.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = '${name}'`)).rows[0].n === 1;

describe("createTestDbBeforeMigration", () => {
  it("replays only migrations before the pinned one, then applies exactly that one", async () => {
    expect(QR_MIGRATION).toBe("0002_qr_cards_and_scans");
    const { client, apply } = await createTestDbBeforeMigration(QR_MIGRATION);
    expect(await hasTable(client, "students")).toBe(true);
    expect(await hasTable(client, "attendance_scans")).toBe(false);
    await apply();
    expect(await hasTable(client, "attendance_scans")).toBe(true);
  });

  it("rejects an unknown migration tag", async () => {
    await expect(createTestDbBeforeMigration("9999_nope")).rejects.toThrow(/9999_nope/);
  });
});
