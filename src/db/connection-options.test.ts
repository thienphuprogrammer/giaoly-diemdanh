import { describe, expect, it } from "vitest";
import { parsePoolMax, postgresOptionsFromEnv } from "./connection-options";

describe("parsePoolMax", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    [" 3 ", 3],
    ["20", 20],
  ])("chấp nhận %j", (raw, want) => expect(parsePoolMax(raw)).toBe(want));
  it.each([undefined, "", "0", "-1", "21", "2.5", "abc", "1e1"])("từ chối %j", (raw) => expect(parsePoolMax(raw)).toBeNull());
});

describe("postgresOptionsFromEnv", () => {
  it("mặc định: pool 5, prepared statements bật, timeout hợp lý", () => {
    expect(postgresOptionsFromEnv({})).toEqual({ max: 5, prepare: true, idle_timeout: 20, connect_timeout: 10 });
  });
  it("DB_POOL_MAX hợp lệ ghi đè, không hợp lệ về mặc định", () => {
    expect(postgresOptionsFromEnv({ DB_POOL_MAX: "2" }).max).toBe(2);
    expect(postgresOptionsFromEnv({ DB_POOL_MAX: "999" }).max).toBe(5);
  });
  it("DB_PREPARE=false (hoặc 0) tắt prepared statements cho pooler giao dịch", () => {
    expect(postgresOptionsFromEnv({ DB_PREPARE: "false" }).prepare).toBe(false);
    expect(postgresOptionsFromEnv({ DB_PREPARE: "0" }).prepare).toBe(false);
    expect(postgresOptionsFromEnv({ DB_PREPARE: "true" }).prepare).toBe(true);
    expect(postgresOptionsFromEnv({ DB_PREPARE: "" }).prepare).toBe(true);
  });
});
