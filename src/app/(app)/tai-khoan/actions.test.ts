import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import { hashPassword } from "@/lib/auth/password";
import { encryptSession } from "@/lib/auth/session";
import { loadSessionUser } from "@/lib/auth/session-user";
import { createTestDb } from "@/test/db";

/** Server action chạy ngoài Next: giả lập kho cookie, header, revalidate và DB (PGlite). */
const h = vi.hoisted(() => ({
  db: undefined as unknown,
  jar: new Map<string, string>(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ get db() { return h.db; } }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name) } : undefined),
    set: (name: string, value: string) => { h.jar.set(name, value); },
    delete: (name: string) => { h.jar.delete(name); },
  }),
}));

const { changePasswordAction } = await import("./actions");

const OLD_PW = "mat-khau-cu-123";
const NEW_PW = "mat-khau-moi-456";
const SIGNING_KEY = "k".repeat(40);
const nowS = () => Math.floor(Date.now() / 1000);

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}

async function setup() {
  const db = await createTestDb();
  h.db = db;
  const [user] = await db.insert(users).values({ email: "glv@x.vn", name: "GLV", passwordHash: await hashPassword(OLD_PW) }).returning();
  // Phiên của thiết bị này và của một thiết bị khác, cả hai đăng nhập trước khi đổi.
  const thisDevice = await encryptSession({ userId: user.id, sat: nowS() - 120 }, SIGNING_KEY);
  const otherDevice = await encryptSession({ userId: user.id, sat: nowS() - 60 }, SIGNING_KEY);
  h.jar.set("session", thisDevice);
  return { db: db as Db, user, thisDevice, otherDevice };
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SIGNING_KEY);
  h.jar.clear();
  h.revalidatePath.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("changePasswordAction", () => {
  it("changes the password, re-issues THIS device's session (still valid) and revokes the other device", async () => {
    const { db, user, thisDevice, otherDevice } = await setup();
    const state = await changePasswordAction(undefined, form({ currentPassword: OLD_PW, newPassword: NEW_PW, confirmPassword: NEW_PW }));
    expect(state).toEqual({ ok: true });
    const reissued = h.jar.get("session");
    expect(reissued).toBeTruthy();
    expect(reissued).not.toBe(thisDevice);
    expect((await loadSessionUser(db, reissued, SIGNING_KEY))?.id).toBe(user.id);
    expect(await loadSessionUser(db, thisDevice, SIGNING_KEY)).toBeNull();
    expect(await loadSessionUser(db, otherDevice, SIGNING_KEY)).toBeNull();
    expect(h.revalidatePath).toHaveBeenCalledWith("/tai-khoan");
  });

  it("returns the error and field for a wrong current password and leaves the session alone", async () => {
    const { db, thisDevice } = await setup();
    const state = await changePasswordAction(undefined, form({ currentPassword: "sai-mat-khau-1", newPassword: NEW_PW, confirmPassword: NEW_PW }));
    expect(state).toEqual({ error: "Mật khẩu hiện tại không đúng", field: "currentPassword" });
    expect(h.jar.get("session")).toBe(thisDevice);
    expect(await loadSessionUser(db, thisDevice, SIGNING_KEY)).not.toBeNull();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("treats missing fields as validation errors", async () => {
    await setup();
    expect(await changePasswordAction(undefined, form({}))).toEqual({ error: "Nhập mật khẩu hiện tại", field: "currentPassword" });
  });

  it("requires a signed-in user (redirects to /login without touching the DB)", async () => {
    await setup();
    h.jar.clear();
    await expect(changePasswordAction(undefined, form({ currentPassword: OLD_PW, newPassword: NEW_PW, confirmPassword: NEW_PW })))
      .rejects.toThrow(/NEXT_REDIRECT/);
  });
});
