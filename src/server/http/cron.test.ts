import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CRON_SECRET_MIN_LENGTH, authorizeCron, handleCronRequest } from "./cron";

const token = () => randomBytes(36).toString("base64url"); // 48 ký tự, sinh lúc chạy
const req = (headers: Record<string, string> = {}, method = "GET") => new Request("http://localhost/api/cron/nhac-viec", { method, headers });
const summary = { sent: 2, skipped: 3, failed: 1, pruned: 4, complete: true };

describe("authorizeCron", () => {
  it("đúng header Bearer thì cho qua", () => {
    const s = token();
    expect(authorizeCron(`Bearer ${s}`, s)).toBe("ok");
  });

  it.each([
    ["thiếu header", null],
    ["rỗng", ""],
    ["sai bí mật", "Bearer x"],
    ["bí mật trong tiền tố khác", "Token SECRET"],
    ["thiếu tiền tố", "SECRET"],
    ["sai tiền tố", "Basic SECRET"],
    ["chữ thường", "bearer SECRET"],
    ["thừa khoảng trắng", "Bearer  SECRET"],
    ["thừa đuôi", "Bearer SECRETx"],
    ["thiếu một ký tự", "Bearer SECRE"],
  ])("%s thì từ chối", (_, header) => {
    const s = token();
    expect(authorizeCron(header === null ? null : header.replace("SECRET", s), s)).toBe("denied");
  });

  it("bí mật chưa đặt hoặc ngắn hơn 32 ký tự thì coi như chưa cấu hình (đóng), kể cả khi header khớp", () => {
    expect(CRON_SECRET_MIN_LENGTH).toBe(32);
    expect(authorizeCron("Bearer ", undefined)).toBe("unconfigured");
    expect(authorizeCron("Bearer ", "")).toBe("unconfigured");
    const short = randomBytes(31).toString("hex").slice(0, 31);
    expect(authorizeCron(`Bearer ${short}`, short)).toBe("unconfigured");
    const exact = randomBytes(32).toString("hex").slice(0, 32);
    expect(authorizeCron(`Bearer ${exact}`, exact)).toBe("ok");
  });

  it("bí mật chỉ gồm khoảng trắng bị coi như chưa đặt", () => {
    const blank = " ".repeat(40);
    expect(authorizeCron(`Bearer ${blank}`, blank)).toBe("unconfigured");
  });
});

describe("handleCronRequest", () => {
  const setup = (secret: string | undefined) => {
    const run = vi.fn(async () => summary);
    const log = vi.fn();
    const now = new Date("2026-10-11T02:00:00Z");
    return { run, log, now, deps: { env: { CRON_SECRET: secret }, run, log, now: () => now } };
  };

  it("đúng bí mật: chạy với `now` và trả số đếm, không cache", async () => {
    const s = token();
    const { run, now, deps } = setup(s);
    for (const method of ["GET", "POST"]) {
      const res = await handleCronRequest(req({ authorization: `Bearer ${s}` }, method), deps);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(summary);
    }
    expect(run).toHaveBeenCalledWith(now);
  });

  it("thiếu hoặc sai bí mật: 401, không chạy, không lộ bí mật", async () => {
    const s = token();
    const { run, log, deps } = setup(s);
    for (const headers of [{}, { authorization: `Bearer ${token()}` }, { authorization: s }] as Record<string, string>[]) {
      const res = await handleCronRequest(req(headers), deps);
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(text).not.toContain(s);
    }
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(s);
  });

  it("CRON_SECRET chưa đặt hoặc quá ngắn: 503 thân chung, không bao giờ chạy", async () => {
    for (const secret of [undefined, "", "short-value"]) {
      const { run, deps } = setup(secret);
      const res = await handleCronRequest(req({ authorization: `Bearer ${secret ?? ""}` }), deps);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "unavailable" });
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("lỗi khi chạy: 500 thân chung, log không chứa chi tiết lỗi hay bí mật", async () => {
    const s = token();
    const { log, deps } = setup(s);
    const failing = { ...deps, run: vi.fn(async () => { throw new Error(`boom postgres://user:pw@host/db ${s}`); }) };
    const res = await handleCronRequest(req({ authorization: `Bearer ${s}` }), failing);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("cron");
    expect(logged).not.toContain(s);
    expect(logged).not.toContain("postgres://");
  });

  it("chỉ trả các số đếm (không trả thêm trường nào khác do run trả về)", async () => {
    const s = token();
    const { deps } = setup(s);
    const leaky = { ...deps, run: vi.fn(async () => ({ ...summary, users: ["x@y.vn"] }) as typeof summary) };
    const res = await handleCronRequest(req({ authorization: `Bearer ${s}` }), leaky);
    expect(Object.keys(await res.json()).sort()).toEqual(["complete", "failed", "pruned", "sent", "skipped"]);
  });
});
