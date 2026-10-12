import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isVapidPublicKey } from "@/lib/push/vapid";

describe("pnpm push:keys", () => {
  it("prints a fresh valid key pair as env lines on stdout and the warning on stderr", () => {
    const run = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/push-keys.ts"], { encoding: "utf8" });
    const [a, b] = [run(), run()];
    expect(a.status).toBe(0);
    const env = Object.fromEntries(a.stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    expect(Object.keys(env)).toEqual(["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]);
    expect(isVapidPublicKey(env.VAPID_PUBLIC_KEY)).toBe(true);
    expect(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url")).toHaveLength(32);
    expect(a.stderr).toContain("không commit");
    expect(b.stdout).not.toBe(a.stdout);
  });
});
