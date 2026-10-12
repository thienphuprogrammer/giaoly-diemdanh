import { describe, expect, it } from "vitest";
import { createHealthHandler, handleHealth, versionFromEnv } from "./health";

describe("versionFromEnv", () => {
  it("lấy 7 ký tự đầu của commit Vercel", () => expect(versionFromEnv({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456"));
  it("không có thì là dev", () => {
    expect(versionFromEnv({})).toBe("dev");
    expect(versionFromEnv({ VERCEL_GIT_COMMIT_SHA: "" })).toBe("dev");
  });
});

describe("handleHealth", () => {
  it("DB tốt: 200, ok và db true, không lưu cache", async () => {
    const res = await handleHealth({ checkDb: async () => undefined, version: "abc1234" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, db: true, version: "abc1234" });
  });

  it("DB lỗi: 503, db false, không lộ chi tiết lỗi", async () => {
    const leak = "password authentication failed for host=db.internal";
    const res = await handleHealth({ checkDb: async () => { throw new Error(leak); }, version: "dev" });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("password");
    expect(text).not.toContain("internal");
    expect(JSON.parse(text)).toEqual({ ok: false, db: false, version: "dev" });
  });

  it("DB treo quá thời hạn: 503 và không chờ mãi", async () => {
    const started = Date.now();
    const res = await handleHealth({ checkDb: () => new Promise(() => undefined), version: "dev", timeoutMs: 30 });
    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(1000);
    expect((await res.json()).db).toBe(false);
  });
});

describe("createHealthHandler (nhớ kết quả ngắn hạn)", () => {
  it("gọi DB một lần trong cửa sổ, gọi lại sau khi hết hạn", async () => {
    let calls = 0;
    let now = 1000;
    const h = createHealthHandler({ checkDb: async () => { calls++; }, version: "v", ttlMs: 5000, now: () => now });
    await h(); await h(); await h();
    expect(calls).toBe(1);
    now += 4999;
    await h();
    expect(calls).toBe(1);
    now += 2;
    await h();
    expect(calls).toBe(2);
  });
  it("nhiều request đồng thời dùng chung một lần kiểm tra", async () => {
    let calls = 0;
    const h = createHealthHandler({ checkDb: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); }, version: "v", now: () => 0 });
    const rs = await Promise.all([h(), h(), h(), h()]);
    expect(calls).toBe(1);
    expect(rs.every((r) => r.status === 200)).toBe(true);
  });
  it("cũng nhớ kết quả lỗi (chống dồn tải khi DB sập) và mỗi lần trả Response mới", async () => {
    let calls = 0;
    const h = createHealthHandler({ checkDb: async () => { calls++; throw new Error("x"); }, version: "v", now: () => 0 });
    const a = await h(); const b = await h();
    expect(calls).toBe(1);
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(a).not.toBe(b);
    expect(b.headers.get("cache-control")).toBe("no-store");
  });
});
