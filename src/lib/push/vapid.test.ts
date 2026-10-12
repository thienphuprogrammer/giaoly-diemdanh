import { randomBytes } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { VapidConfigError, checkVapid, vapidFromEnv, vapidPublicKeyFromEnv } from "./vapid";

/** Khoá sinh lúc chạy, không có hằng số khoá trong mã nguồn. */
const fresh = () => {
  const k = webpush.generateVAPIDKeys();
  return { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: "mailto:chu-du-an@giaoxu.vn" };
};

describe("vapidFromEnv", () => {
  it("returns the trimmed configuration when all three variables are valid", () => {
    const env = fresh();
    expect(vapidFromEnv({ ...env, VAPID_SUBJECT: ` ${env.VAPID_SUBJECT} ` })).toEqual({
      publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT,
    });
    expect(vapidFromEnv({ ...env, VAPID_SUBJECT: "https://diemdanh.giaoxu.vn" }).subject).toBe("https://diemdanh.giaoxu.vn");
  });

  it.each([
    ["missing public key", { VAPID_PUBLIC_KEY: undefined }, /VAPID_PUBLIC_KEY/],
    ["missing private key", { VAPID_PRIVATE_KEY: "" }, /VAPID_PRIVATE_KEY/],
    ["missing subject", { VAPID_SUBJECT: undefined }, /VAPID_SUBJECT/],
    ["public key wrong length", { VAPID_PUBLIC_KEY: randomBytes(64).toString("base64url") }, /VAPID_PUBLIC_KEY/],
    ["public key not uncompressed", { VAPID_PUBLIC_KEY: Buffer.concat([Buffer.from([3]), randomBytes(64)]).toString("base64url") }, /VAPID_PUBLIC_KEY/],
    ["public key standard base64", { VAPID_PUBLIC_KEY: "+/" + randomBytes(63).toString("base64url") }, /VAPID_PUBLIC_KEY/],
    ["private key wrong length", { VAPID_PRIVATE_KEY: randomBytes(31).toString("base64url") }, /VAPID_PRIVATE_KEY/],
    ["subject http", { VAPID_SUBJECT: "http://giaoxu.vn" }, /VAPID_SUBJECT/],
    ["subject localhost", { VAPID_SUBJECT: "https://localhost" }, /VAPID_SUBJECT/],
    ["subject mailto without address", { VAPID_SUBJECT: "mailto:" }, /VAPID_SUBJECT/],
    ["subject bare email", { VAPID_SUBJECT: "a@b.vn" }, /VAPID_SUBJECT/],
  ])("fails closed on %s with a message naming the variable but never a value", (_n, patch, name) => {
    const env = { ...fresh(), ...patch };
    let error: unknown;
    try { vapidFromEnv(env); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VapidConfigError);
    const message = (error as Error).message;
    expect(message).toMatch(name);
    for (const v of Object.values(env)) if (v && v.length > 12) expect(message).not.toContain(v);
  });
});

describe("checkVapid / vapidPublicKeyFromEnv", () => {
  it("reports unset as not configured (not an error) and exposes no public key", () => {
    expect(checkVapid({})).toEqual({ status: "unset" });
    expect(vapidPublicKeyFromEnv({})).toBeNull();
  });

  it("reports partial or invalid as invalid with the problems, and exposes no public key", () => {
    const env = { ...fresh(), VAPID_SUBJECT: "nope" };
    const r = checkVapid(env);
    expect(r.status).toBe("invalid");
    expect(vapidPublicKeyFromEnv(env)).toBeNull();
    expect(checkVapid({ VAPID_PUBLIC_KEY: fresh().VAPID_PUBLIC_KEY }).status).toBe("invalid");
  });

  it("exposes only the public key when everything is valid", () => {
    const env = fresh();
    expect(checkVapid(env).status).toBe("ok");
    expect(vapidPublicKeyFromEnv(env)).toBe(env.VAPID_PUBLIC_KEY);
  });
});
