import { describe, expect, it } from "vitest";
import { databaseUrlFromEnv, parsePoolMax, postgresOptionsFromEnv, sanitizeDatabaseUrl, strippedUrlParams } from "./connection-options";

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

describe("sanitizeDatabaseUrl", () => {
  const base = "postgres://u:p%40ss@host.example.com:5432/db";
  it("không có query thì giữ nguyên", () => expect(sanitizeDatabaseUrl(base)).toBe(base));
  it("giữ sslmode=require", () => expect(sanitizeDatabaseUrl(`${base}?sslmode=require`)).toBe(`${base}?sslmode=require`));
  it("bỏ channel_binding của Neon, giữ sslmode", () => {
    expect(sanitizeDatabaseUrl(`${base}?sslmode=require&channel_binding=require`)).toBe(`${base}?sslmode=require`);
  });
  it("bỏ pgbouncer của Supabase và mọi tham số lạ", () => {
    expect(sanitizeDatabaseUrl(`${base}?pgbouncer=true&connection_limit=1`)).toBe(base);
    expect(sanitizeDatabaseUrl(`${base}?options=-c%20search_path%3Dx&sslmode=verify-full`)).toBe(`${base}?sslmode=verify-full`);
  });
  it("không làm hỏng mật khẩu có ký tự đặc biệt", () => expect(sanitizeDatabaseUrl(`${base}?x=1`)).toContain("p%40ss"));
  it("chuỗi không đọc được thì trả nguyên (để driver báo lỗi)", () => expect(sanitizeDatabaseUrl("not a url")).toBe("not a url"));
});

describe("strippedUrlParams", () => {
  it("chỉ trả TÊN tham số bị bỏ, không trả giá trị", () => {
    const names = strippedUrlParams("postgres://u:p@h/d?sslmode=require&channel_binding=require&pgbouncer=true");
    expect(names).toEqual(["channel_binding", "pgbouncer"]);
  });
  it("không có gì bị bỏ thì rỗng; URL hỏng thì rỗng", () => {
    expect(strippedUrlParams("postgres://u:p@h/d?sslmode=require")).toEqual([]);
    expect(strippedUrlParams("garbage")).toEqual([]);
  });
});

describe("databaseUrlFromEnv", () => {
  it("ưu tiên DATABASE_URL_UNPOOLED, chuỗi rỗng coi như không có", () => {
    expect(databaseUrlFromEnv({ DATABASE_URL_UNPOOLED: "a", DATABASE_URL: "b" })).toBe("a");
    expect(databaseUrlFromEnv({ DATABASE_URL_UNPOOLED: "", DATABASE_URL: "b" })).toBe("b");
    expect(databaseUrlFromEnv({ DATABASE_URL: "b" })).toBe("b");
    expect(databaseUrlFromEnv({})).toBe("");
  });
});
