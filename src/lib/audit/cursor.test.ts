import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "./cursor";

const good = { at: "2026-10-12T05:00:00.123456Z", id: "0b1c2d3e-1111-4222-8333-444455556666" };
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

describe("audit cursor", () => {
  it("round-trips and is url-safe", () => {
    const c = encodeCursor(good);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(good);
  });

  it("accepts the edges of the allowed years", () => {
    for (const at of ["2000-01-01T00:00:00.000000Z", "9999-12-31T23:59:59.999999Z", "2024-02-29T12:00:00.000001Z"]) {
      expect(decodeCursor(encodeCursor({ at, id: good.id }))).toEqual({ at, id: good.id });
    }
  });

  it.each([
    ["undefined", undefined], ["empty", ""], ["not base64url", "***"], ["not json", b64("hello")],
    ["wrong shape", b64({ a: 1 })], ["bad date", b64({ a: "2026-13-45T99:00:00.000000Z", i: good.id })],
    ["no micros", b64({ a: "2026-10-12T05:00:00Z", i: good.id })], ["bad id", b64({ a: good.at, i: "nope" })],
    ["Feb 30", b64({ a: "2026-02-30T05:00:00.123456Z", i: good.id })], ["hour 25", b64({ a: "2026-10-12T25:00:00.123456Z", i: good.id })],
    ["year 0000", b64({ a: "0000-01-01T00:00:00.000000Z", i: good.id })], ["year 0001", b64({ a: "0001-01-01T00:00:00.000000Z", i: good.id })],
    ["year 1999", b64({ a: "1999-12-31T23:59:59.999999Z", i: good.id })],
    ["extra key", b64({ a: good.at, i: good.id, x: 1 })], ["too long", "a".repeat(300)], ["array", ["x"]],
  ])("rejects %s", (_n, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
