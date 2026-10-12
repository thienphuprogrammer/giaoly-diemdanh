import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { checkEnv, maskDatabaseUrl, migrationStatus, postgresVersionCheck, summarize, timezoneCheck, type Check } from "./checks";

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
  it("Supabase pooler (host pooler.supabase.com hoặc cổng 6543) mà chưa DB_PREPARE=false thì cảnh báo", () => {
    for (const u of ["postgres://u:p@aws-0.pooler.supabase.com:5432/d?sslmode=require", "postgres://u:p@db.example.com:6543/d?sslmode=require"]) {
      const env = { ...base, DATABASE_URL: u };
      expect(levels(checkEnv(env, { prod: true }), "DB_PREPARE")).toEqual(["warn"]);
      expect(levels(checkEnv({ ...env, DB_PREPARE: "false" }, { prod: true }), "DB_PREPARE")).toEqual([]);
    }
  });
  it("Neon pooled (-pooler) không cần DB_PREPARE=false nên không cảnh báo", () => {
    const env = { ...base, DATABASE_URL: "postgres://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/d?sslmode=require" };
    expect(levels(checkEnv(env, { prod: true }), "DB_PREPARE")).toEqual([]);
  });
  it("tham số URL sẽ bị bỏ (channel_binding, pgbouncer) thì cảnh báo, chỉ nêu tên", () => {
    const env = { ...base, DATABASE_URL: "postgres://u:p@h.example.com/d?sslmode=require&channel_binding=require&pgbouncer=true" };
    const cs = checkEnv(env, { prod: true });
    expect(levels(cs, "DATABASE_PARAMS")).toEqual(["warn"]);
    const msg = cs.find((c) => c.id === "DATABASE_PARAMS")?.message ?? "";
    expect(msg).toContain("channel_binding");
    expect(msg).toContain("pgbouncer");
    expect(levels(checkEnv({ ...base, DATABASE_URL: DB }, { prod: true }), "DATABASE_PARAMS")).toEqual([]);
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
  it("cầu nối E2E được đặt: prod thì LỖI, dev thì cảnh báo", () => {
    expect(levels(checkEnv({ ...base, NEXT_PUBLIC_E2E_SCAN_BRIDGE: "1" }, { prod: true }), "E2E_BRIDGE")).toEqual(["fail"]);
    expect(levels(checkEnv({ ...base, NEXT_PUBLIC_E2E_SCAN_BRIDGE: "1" }, { prod: false }), "E2E_BRIDGE")).toEqual(["warn"]);
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
  it("VAPID_* chỉ thông tin; CRON_SECRET thiếu thì cảnh báo (production) kèm chỉ dẫn tài liệu; không mục nào làm fail", () => {
    expect(levels(checkEnv(base, { prod: false }), "OPTIONAL_CRON")).toEqual(["info"]);
    expect(checkEnv(base, { prod: false }).find((c) => c.id === "OPTIONAL_CRON")?.message).toMatch(/docs\/deploy-vercel-ios\.md/);
    const cs = checkEnv(base, { prod: true });
    expect(levels(cs, "OPTIONAL_PUSH")).toEqual(["info"]);
    expect(levels(cs, "OPTIONAL_CRON")).toEqual(["warn"]);
    expect(cs.find((c) => c.id === "OPTIONAL_CRON")?.message).toMatch(/docs\/deploy-vercel-ios\.md/);
    expect(cs.find((c) => c.id === "OPTIONAL_CRON")?.message).toContain("openssl rand -base64 48");
    expect(summarize(cs).failed).toBe(false);
    const keys = webpush.generateVAPIDKeys();
    const cron = randomBytes(24).toString("hex");
    const set = checkEnv({ ...base, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:a@giaoxu.vn", CRON_SECRET: cron }, { prod: true });
    expect(set.filter((c) => c.id.startsWith("OPTIONAL")).every((c) => c.level === "info")).toBe(true);
    expect(set.find((c) => c.id === "OPTIONAL_PUSH")?.message).toContain("hợp lệ");
    const dump = JSON.stringify(set);
    for (const v of [keys.publicKey, keys.privateKey, cron]) expect(dump).not.toContain(v);
  });

  it("CRON_SECRET ngắn hơn 32 ký tự hoặc trông như giá trị mẫu thì cảnh báo (route sẽ trả 503), không in giá trị", () => {
    const short = randomBytes(8).toString("hex");
    const cs = checkEnv({ ...base, CRON_SECRET: short }, { prod: true });
    expect(levels(cs, "OPTIONAL_CRON")).toEqual(["warn"]);
    expect(cs.find((c) => c.id === "OPTIONAL_CRON")?.message).toContain("32");
    expect(JSON.stringify(cs)).not.toContain(short);
    expect(levels(checkEnv({ ...base, CRON_SECRET: "x".repeat(40) }, { prod: true }), "OPTIONAL_CRON")).toEqual(["warn"]);
    const good = randomBytes(36).toString("base64");
    expect(levels(checkEnv({ ...base, CRON_SECRET: good }, { prod: true }), "OPTIONAL_CRON")).toEqual(["info"]);
  });

  it("CRON_SECRET có khoảng trắng đầu/cuối thì cảnh báo (app tự cắt, nhưng nơi gọi có thể gửi giá trị khác)", () => {
    const good = randomBytes(36).toString("base64");
    for (const v of [` ${good}`, `${good}\n`, `${good} `]) {
      const cs = checkEnv({ ...base, CRON_SECRET: v }, { prod: true });
      expect(levels(cs, "OPTIONAL_CRON")).toEqual(["warn"]);
      expect(cs.find((c) => c.id === "OPTIONAL_CRON")?.message).toMatch(/khoảng trắng/);
      expect(JSON.stringify(cs)).not.toContain(good);
    }
  });

  it("PUSH_DRY_RUN đặt: production thì LỖI, dev thì ghi chú; không đặt thì không có mục", () => {
    expect(levels(checkEnv({ ...base, PUSH_DRY_RUN: "1" }, { prod: true }), "PUSH_DRY_RUN")).toEqual(["fail"]);
    expect(summarize(checkEnv({ ...base, PUSH_DRY_RUN: "1" }, { prod: true })).failed).toBe(true);
    expect(levels(checkEnv({ ...base, PUSH_DRY_RUN: "1" }, { prod: false }), "PUSH_DRY_RUN")).toEqual(["info"]);
    expect(levels(checkEnv(base, { prod: true }), "PUSH_DRY_RUN")).toEqual([]);
  });

  it("VAPID_* đặt thiếu hoặc sai thì cảnh báo (không fail), nêu tên biến nhưng không in giá trị", () => {
    const [pub, priv] = [randomBytes(12).toString("hex"), randomBytes(12).toString("hex")];
    const cs = checkEnv({ ...base, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv }, { prod: true });
    const push = cs.find((c) => c.id === "OPTIONAL_PUSH");
    expect(push?.level).toBe("warn");
    expect(push?.message).toMatch(/VAPID_PUBLIC_KEY[\s\S]*VAPID_PRIVATE_KEY[\s\S]*VAPID_SUBJECT/);
    expect(summarize(cs).failed).toBe(false);
    for (const v of [pub, priv]) expect(JSON.stringify(cs)).not.toContain(v);
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

describe("timezoneCheck", () => {
  it.each(["UTC", "Etc/UTC", "utc", "GMT"])("%s is fine", (tz) => {
    expect(timezoneCheck(tz)).toMatchObject({ id: "DB_TIMEZONE", level: "ok" });
  });
  it.each(["Asia/Ho_Chi_Minh", "America/New_York", "", null, undefined])("%s warns", (tz) => {
    expect(timezoneCheck(tz)).toMatchObject({ id: "DB_TIMEZONE", level: "warn" });
  });
});

describe("postgresVersionCheck", () => {
  it.each(["150000", "150004", "160002", "170000", 170004])("%s (PostgreSQL ≥ 15) đạt", (v) => {
    expect(postgresVersionCheck(v)).toMatchObject({ id: "DB_VERSION", level: "ok" });
  });
  it.each(["140011", "130000", 120000])("%s (PostgreSQL < 15) là lỗi, nêu NULLS NOT DISTINCT", (v) => {
    const c = postgresVersionCheck(v);
    expect(c).toMatchObject({ id: "DB_VERSION", level: "fail" });
    expect(c.message).toContain("NULLS NOT DISTINCT");
    expect(c.message).toContain("15");
  });
  it.each(["", "abc", null, undefined, "15.4"])("%s không đọc được là lỗi", (v) => {
    expect(postgresVersionCheck(v)).toMatchObject({ id: "DB_VERSION", level: "fail" });
  });
});
