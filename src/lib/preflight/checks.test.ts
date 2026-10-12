import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, maskDatabaseUrl, migrationStatus, summarize, type Check } from "./checks";

const goodSecret = () => randomBytes(36).toString("base64");
const DB = "postgres://appuser:s3cretpw@ep-quiet-sky-123456.ap-southeast-1.aws.neon.tech:5432/diemdanh?sslmode=require";
const levels = (cs: Check[], id: string) => cs.filter((c) => c.id === id).map((c) => c.level);

describe("maskDatabaseUrl", () => {
  it("che user và host, không bao giờ in mật khẩu", () => {
    const m = maskDatabaseUrl(DB);
    expect(m).not.toContain("s3cretpw");
    expect(m).not.toContain("appuser");
    expect(m).not.toContain("ep-quiet-sky-123456");
    expect(m).toContain("ap");
    expect(m).toContain("neon.tech");
    expect(m).toContain("/diemdanh");
  });
  it("không in lại đầu vào khi không đọc được", () => {
    const m = maskDatabaseUrl("not a url with secretword");
    expect(m).not.toContain("secretword");
  });
  it("URL không có user vẫn ổn", () => expect(maskDatabaseUrl("postgres://localhost:5432/x")).toContain("/x"));
});

describe("checkEnv: DATABASE_URL", () => {
  const base = { AUTH_SECRET: goodSecret() };
  it("thiếu thì fail", () => expect(levels(checkEnv(base, { prod: false }), "DATABASE_URL")).toEqual(["fail"]));
  it("không đọc được thì fail và không lộ giá trị", () => {
    const cs = checkEnv({ ...base, DATABASE_URL: "garbage-value-xyz" }, { prod: false });
    expect(levels(cs, "DATABASE_URL")).toEqual(["fail"]);
    expect(JSON.stringify(cs)).not.toContain("garbage-value-xyz");
  });
  it("hosted hợp lệ thì ok", () => expect(levels(checkEnv({ ...base, DATABASE_URL: DB }, { prod: true }), "DATABASE_URL")).toEqual(["ok"]));
  it.each(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"])("localhost (%s) ở chế độ prod thì fail, dev thì ok", (host) => {
    const env = { ...base, DATABASE_URL: `postgres://u:p@${host}:5432/d` };
    expect(levels(checkEnv(env, { prod: true }), "DATABASE_URL")).toEqual(["fail"]);
    expect(levels(checkEnv(env, { prod: false }), "DATABASE_URL")).toEqual(["ok"]);
  });
  it("host hosted thiếu sslmode ở prod thì cảnh báo", () => {
    const env = { ...base, DATABASE_URL: "postgres://u:p@db.example.com:5432/d" };
    expect(levels(checkEnv(env, { prod: true }), "DATABASE_SSL")).toEqual(["warn"]);
    expect(levels(checkEnv({ ...base, DATABASE_URL: DB }, { prod: true }), "DATABASE_SSL")).toEqual([]);
  });
  it("cổng 6543 hoặc 'pooler' mà chưa DB_PREPARE=false thì cảnh báo", () => {
    const env = { ...base, DATABASE_URL: "postgres://u:p@aws-0.pooler.supabase.com:6543/d?sslmode=require" };
    expect(levels(checkEnv(env, { prod: true }), "DB_PREPARE")).toEqual(["warn"]);
    expect(levels(checkEnv({ ...env, DB_PREPARE: "false" }, { prod: true }), "DB_PREPARE")).toEqual([]);
  });
});

describe("checkEnv: AUTH_SECRET", () => {
  const base = { DATABASE_URL: DB };
  it("thiếu hoặc ngắn thì fail", () => {
    expect(levels(checkEnv(base, { prod: true }), "AUTH_SECRET")).toEqual(["fail"]);
    expect(levels(checkEnv({ ...base, AUTH_SECRET: "a1b2c3" }, { prod: true }), "AUTH_SECRET")).toEqual(["fail"]);
  });
  it("lặp ký tự hoặc giá trị mẫu thì fail", () => {
    expect(levels(checkEnv({ ...base, AUTH_SECRET: "x".repeat(40) }, { prod: true }), "AUTH_SECRET")).toEqual(["fail"]);
    expect(levels(checkEnv({ ...base, AUTH_SECRET: "ab".repeat(20) }, { prod: true }), "AUTH_SECRET")).toEqual(["fail"]);
    expect(levels(checkEnv({ ...base, AUTH_SECRET: "please-change-me-".repeat(3) }, { prod: true }), "AUTH_SECRET")).toEqual(["fail"]);
  });
  it("khóa ngẫu nhiên đủ dài thì ok, và không in khóa ra", () => {
    const secret = goodSecret();
    const cs = checkEnv({ ...base, AUTH_SECRET: secret }, { prod: true });
    expect(levels(cs, "AUTH_SECRET")).toEqual(["ok"]);
    expect(JSON.stringify(cs)).not.toContain(secret);
  });
});

describe("checkEnv: cờ nguy hiểm và tùy chọn", () => {
  const base = { DATABASE_URL: DB, AUTH_SECRET: goodSecret() };
  it("cầu nối E2E được đặt thì cảnh báo", () => {
    expect(levels(checkEnv({ ...base, NEXT_PUBLIC_E2E_SCAN_BRIDGE: "1" }, { prod: true }), "E2E_BRIDGE")).toEqual(["warn"]);
    expect(levels(checkEnv(base, { prod: true }), "E2E_BRIDGE")).toEqual([]);
  });
  it("CSP_ALLOW_UNSAFE_EVAL=1 thì cảnh báo kèm giải thích", () => {
    const cs = checkEnv({ ...base, CSP_ALLOW_UNSAFE_EVAL: "1" }, { prod: true });
    expect(levels(cs, "CSP_UNSAFE_EVAL")).toEqual(["warn"]);
    expect(cs.find((c) => c.id === "CSP_UNSAFE_EVAL")?.message).toContain("iOS 15");
    expect(levels(checkEnv(base, { prod: true }), "CSP_UNSAFE_EVAL")).toEqual([]);
  });
  it("DB_POOL_MAX không hợp lệ thì cảnh báo", () => {
    expect(levels(checkEnv({ ...base, DB_POOL_MAX: "abc" }, { prod: true }), "DB_POOL_MAX")).toEqual(["warn"]);
    expect(levels(checkEnv({ ...base, DB_POOL_MAX: "3" }, { prod: true }), "DB_POOL_MAX")).toEqual([]);
  });
  it("VAPID_* và CRON_SECRET chỉ thông tin, thiếu không làm fail", () => {
    const cs = checkEnv(base, { prod: true });
    expect(levels(cs, "OPTIONAL_PUSH")).toEqual(["info"]);
    expect(levels(cs, "OPTIONAL_CRON")).toEqual(["info"]);
    expect(summarize(cs).failed).toBe(false);
    const set = checkEnv({ ...base, VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b", CRON_SECRET: "c" }, { prod: true });
    expect(set.filter((c) => c.id.startsWith("OPTIONAL")).every((c) => c.level === "info")).toBe(true);
    expect(JSON.stringify(set)).not.toMatch(/"message":"[^"]*\b(b|c)\b"/);
  });
});

describe("migrationStatus", () => {
  it("khớp thì ok", () => expect(migrationStatus(5, 5).level).toBe("ok"));
  it("DB thiếu migration thì fail và nhắc pnpm db:migrate", () => {
    const c = migrationStatus(5, 3);
    expect(c.level).toBe("fail");
    expect(c.message).toContain("pnpm db:migrate");
  });
  it("DB chưa có bảng migration (0) thì fail", () => expect(migrationStatus(5, 0).level).toBe("fail"));
  it("DB mới hơn mã thì cảnh báo", () => expect(migrationStatus(5, 6).level).toBe("warn"));
});

describe("summarize", () => {
  it("failed khi có fail; đếm từng mức", () => {
    const s = summarize([
      { id: "a", level: "ok", message: "" },
      { id: "b", level: "warn", message: "" },
      { id: "c", level: "fail", message: "" },
    ]);
    expect(s).toEqual({ ok: 1, warn: 1, fail: 1, info: 0, failed: true });
  });
});
