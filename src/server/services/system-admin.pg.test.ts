import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, grades, loginAttempts, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { ADMIN_LOCK } from "@/lib/auth/admin-lock";
import { hashPassword } from "@/lib/auth/password";
import { createRealPgDb, realPgUrl } from "@/test/pg";
import { createGrade, resetAccountPassword, setAccountActive, updateAccount } from "./system-admin";

const FORBIDDEN = "Bạn không có quyền thực hiện thao tác này";
/** Both admins share this password so either can pass the step-up check (M1). */
const ADMIN_PW = "pg-race-admin-pass-1";
type Account = typeof users.$inferSelect;

/** Real connections must queue behind the shared lock before either authenticated request can mutate. */
describe.skipIf(!realPgUrl)("system administrator races on real Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let first: Account;
  let second: Account;
  let adminHash: string;

  beforeAll(async () => {
    ({ db, close } = await createRealPgDb(8));
    adminHash = await hashPassword(ADMIN_PW);
  });
  afterAll(async () => { await close?.(); });

  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(loginAttempts);
    await db.delete(grades);
    await db.delete(users);
    [first, second] = await db.insert(users).values([
      { email: "admin-a@e2e.vn", name: "Admin A", passwordHash: adminHash, isAdmin: true },
      { email: "admin-b@e2e.vn", name: "Admin B", passwordHash: adminHash, isAdmin: true },
    ]).returning();
  });

  async function waitForQueuedMutations(count: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [waiting] = await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_locks
        where locktype = 'advisory' and not granted
          and classid = 0 and objid = ${ADMIN_LOCK} and objsubid = 1
          and database = (select oid from pg_database where datname = current_database())
      `);
      if (Number(waiting.n) === count) return;
      await db.execute(sql`select pg_sleep(0.01)`);
    }
    throw new Error(`Expected ${count} administrative requests to queue on separate Postgres connections`);
  }

  async function withAdministrativeLock<T>(run: (
    unlock: () => Promise<void>,
    track: <R>(request: Promise<R>) => Promise<R>,
  ) => Promise<T>): Promise<T> {
    const ready = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    const pending: Promise<unknown>[] = [];
    const track = <R,>(request: Promise<R>): Promise<R> => {
      pending.push(request);
      return request;
    };
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${ADMIN_LOCK})`);
      ready.resolve();
      await released.promise;
    });
    // A failed holder must also fail the readiness barrier, rather than leaving the test hanging.
    void holder.catch(ready.reject);
    try {
      await ready.promise;
      return await run(async () => {
        released.resolve();
        await holder;
      }, track);
    } finally {
      released.resolve();
      try {
        await holder;
      } finally {
        // A failed queue barrier must not let late mutations race the next test's fixture cleanup.
        await Promise.allSettled(pending);
      }
    }
  }

  const activeAdmins = () => db.select({ id: users.id }).from(users).where(and(eq(users.isAdmin, true), eq(users.isActive, true)));

  it("lets only one of two administrators disable the other, leaving exactly one active administrator", async () => {
    const results = await withAdministrativeLock(async (unlock, track) => {
      const pending = Promise.all([
        track(setAccountActive(db, first, { userId: second.id, isActive: false, currentPassword: ADMIN_PW })),
        track(setAccountActive(db, second, { userId: first.id, isActive: false, currentPassword: ADMIN_PW })),
      ]);
      await waitForQueuedMutations(2);
      await unlock();
      return pending;
    });
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: FORBIDDEN }]);
    expect(await activeAdmins()).toHaveLength(1);
    const accounts = await db.select().from(users);
    expect(accounts.filter((account) => account.isActive)).toHaveLength(1);
    expect(accounts.filter((account) => !account.isActive)[0].sessionVersion).toBe(1);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "account.deactivate"))).toHaveLength(1);
  });

  it("lets only one of two administrators demote the other, leaving exactly one active administrator", async () => {
    const demote = (account: Account) => ({ userId: account.id, name: account.name, email: account.email, role: "catechist", gradeId: null, currentPassword: ADMIN_PW });
    const results = await withAdministrativeLock(async (unlock, track) => {
      const pending = Promise.all([
        track(updateAccount(db, first, demote(second))),
        track(updateAccount(db, second, demote(first))),
      ]);
      await waitForQueuedMutations(2);
      await unlock();
      return pending;
    });
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: FORBIDDEN }]);
    expect(await activeAdmins()).toHaveLength(1);
    const accounts = await db.select().from(users);
    expect(accounts.every((account) => account.isActive)).toBe(true);
    expect(accounts.filter((account) => !account.isAdmin)[0].sessionVersion).toBe(1);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "account.update"))).toHaveLength(1);
  });

  it("rejects a queued create-grade request after its still-admin actor has their password reset", async () => {
    const gradeName = "Không tạo bằng phiên cũ";
    const [resetResult, createResult] = await withAdministrativeLock(async (unlock, track) => {
      const reset = track(resetAccountPassword(db, second, { userId: first.id, password: "e2e-new-admin-password-1", currentPassword: ADMIN_PW }));
      await waitForQueuedMutations(1);
      const create = track(createGrade(db, first, { name: gradeName }));
      await waitForQueuedMutations(2);
      // PostgreSQL grants conflicting advisory locks in queue order: reset commits before create rechecks its actor.
      await unlock();
      return Promise.all([reset, create]);
    });
    expect(resetResult.ok).toBe(true);
    const [storedActor] = await db.select().from(users).where(eq(users.id, first.id));
    expect(storedActor).toMatchObject({ isAdmin: true, isActive: true, sessionVersion: first.sessionVersion + 1 });
    expect(createResult).toEqual({ ok: false, error: FORBIDDEN });
    expect(await db.select().from(grades).where(eq(grades.name, gradeName))).toHaveLength(0);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "grade.create"))).toHaveLength(0);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "account.reset_credentials"))).toHaveLength(1);
    expect(await activeAdmins()).toHaveLength(2);
  });
});
