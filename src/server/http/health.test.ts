import { describe, expect, it } from "vitest";
import { handleHealth, versionFromEnv } from "./health";

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
