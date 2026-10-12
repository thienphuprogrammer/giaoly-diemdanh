import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditEvents, sessions, students, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { encodeCursor } from "@/lib/audit/cursor";
import { createTestDb } from "@/test/db";
import { seedBasics } from "@/test/fixtures";
import { listAuditLog } from "./audit-log";

type Entity = (typeof auditEvents.$inferInsert)["entity"];

async function setup() {
  const db = await createTestDb();
  const b = await seedBasics(db);
  const [an] = await db.insert(students).values({ classId: b.classId, fullName: "An" }).returning();
  const [sat] = await db.insert(sessions).values({ classId: b.classId, heldOn: "2026-10-10", termId: b.termId }).returning();
  const [mass] = await db.insert(sessions).values({ classId: b.classId, heldOn: "2026-10-11", kind: "mass", termId: b.termId }).returning();
  const [otherSession] = await db.insert(sessions).values({ classId: b.otherClassId, heldOn: "2026-10-10", termId: b.termId }).returning();
  return { db, b, an, sat, mass, otherSession };
}

/** Chèn dòng nhật ký với thời điểm CHÍNH XÁC tới micro giây (Date của JS chỉ có mili giây). */
async function audit(db: Db, at: string, o: { classId?: string | null; gradeId?: string | null; entity?: Entity; action?: string; actorId?: string | null; summary?: object } = {}) {
  const id = crypto.randomUUID();
  await db.execute(sql`insert into audit_events (id, at, actor_id, class_id, grade_id, entity, action, summary) values (
    ${id}::uuid, ${at}::timestamptz, ${o.actorId ?? null}::uuid, ${o.classId ?? null}::uuid, ${o.gradeId ?? null}::uuid,
    ${o.entity ?? "student"}::audit_entity, ${o.action ?? "student.create"}::text, ${JSON.stringify(o.summary ?? { studentName: "An" })}::jsonb)`);
  return id;
}

async function scan(db: Db, at: string, o: { sessionId: string; studentId: string | null; actorId?: string | null; kind?: "scan" | "manual" | "undo"; result?: "applied" | "noop" }) {
  const eventId = crypto.randomUUID();
  await db.execute(sql`insert into attendance_scans (event_id, kind, session_id, student_id, actor_id, mode, payload_hash, prev_status, new_status, result, received_at)
    values (${eventId}::uuid, ${o.kind ?? "scan"}::scan_kind, ${o.sessionId}::uuid, ${o.studentId}::uuid, ${o.actorId ?? null}::uuid, 'present', 'h', null, 'present',
      ${o.result ?? "applied"}::scan_result, ${at}::timestamp)`);
  return eventId;
}

const ALL = (classId: string, extra: object = {}) => ({ classId, ...extra });

describe("listAuditLog authorization", () => {
  it("lets an assigned catechist and the read-only head of the class's grade read; everyone else gets null", async () => {
    const { db, b } = await setup();
    await audit(db, "2026-10-12T05:00:00Z", { classId: b.classId });
    const [headOfOther] = await db.insert(users).values({ email: "h2@x.vn", name: "H2", passwordHash: "x", isGradeHead: true, gradeId: b.otherGradeId }).returning();
    const [outsider] = await db.insert(users).values({ email: "o@x.vn", name: "O", passwordHash: "x" }).returning();
    expect((await listAuditLog(db, b.glv, ALL(b.classId)))?.items).toHaveLength(1);
    expect((await listAuditLog(db, b.head, ALL(b.classId)))?.items).toHaveLength(1);
    expect(await listAuditLog(db, b.otherGlv, ALL(b.classId))).toBeNull();
    expect(await listAuditLog(db, headOfOther, ALL(b.classId))).toBeNull();
    expect(await listAuditLog(db, outsider, ALL(b.classId))).toBeNull();
    expect(await listAuditLog(db, b.glv, ALL("not-a-uuid"))).toBeNull();
    expect(await listAuditLog(db, b.glv, ALL(crypto.randomUUID()))).toBeNull();
    expect(await listAuditLog(db, b.glv, null)).toBeNull();
  });

  it("never returns another class's rows or grade-level rows (no class_id) in a class timeline", async () => {
    const { db, b, otherSession } = await setup();
    await audit(db, "2026-10-12T05:00:00Z", { classId: b.classId, summary: { studentName: "Của lớp A" } });
    await audit(db, "2026-10-12T05:01:00Z", { classId: b.otherClassId, summary: { studentName: "Lớp khác" } });
    await audit(db, "2026-10-12T05:02:00Z", { gradeId: b.gradeId, entity: "grade_settings", action: "grade.mass_threshold", summary: { gradeName: "Khối 1", before: 2, after: 3 } });
    const [kid] = await db.insert(students).values({ classId: b.otherClassId, fullName: "Em lớp khác" }).returning();
    await scan(db, "2026-10-12T05:03:00", { sessionId: otherSession.id, studentId: kid.id });
    const page = await listAuditLog(db, b.glv, ALL(b.classId));
    expect(page?.items.map((i) => i.text)).toEqual([expect.stringContaining("Của lớp A")]);
  });
});

describe("listAuditLog content", () => {
  it("builds display-ready items with the actor name, VN day and Vietnamese text; a deleted actor shows the placeholder", async () => {
    const { db, b } = await setup();
    await audit(db, "2026-10-12T05:00:00Z", {
      classId: b.classId, actorId: b.glv.id, entity: "attendance", action: "attendance.set",
      summary: { studentName: "Bình", sessionDate: "2026-10-12", sessionKind: "class", before: { status: "present", reason: null }, after: { status: "absent_unexcused", reason: null } },
    });
    await audit(db, "2026-10-11T17:30:00Z", { classId: b.classId, actorId: null });
    const page = await listAuditLog(db, b.glv, ALL(b.classId));
    expect(page?.items[0]).toMatchObject({
      source: "audit", actor: "glv@x.vn", entity: "attendance", action: "attendance.set", day: "2026-10-12",
      text: "glv@x.vn đổi Bình: Có mặt → Vắng không phép (buổi 12/10)",
    });
    expect(page?.items[0].at.toISOString()).toBe("2026-10-12T05:00:00.000Z");
    expect(page?.items[1]).toMatchObject({ actor: "Tài khoản đã xoá", day: "2026-10-12", text: "Tài khoản đã xoá thêm em An" }); // 17:30Z = 00:30 giờ VN
  });

  it("shows an unknown or legacy action as a generic line, and an actor deleted afterwards (set null)", async () => {
    const { db, b } = await setup();
    const [temp] = await db.insert(users).values({ email: "t@x.vn", name: "Tạm", passwordHash: "x" }).returning();
    await audit(db, "2026-10-12T05:00:00Z", { classId: b.classId, action: "legacy_thing.do_it", summary: { whatever: { deep: 1 } }, actorId: temp.id });
    await db.delete(users).where(sql`${users.id} = ${temp.id}`);
    const [item] = (await listAuditLog(db, b.glv, ALL(b.classId)))!.items;
    expect(item.text).toBe("Tài khoản đã xoá thực hiện một thay đổi (legacy_thing.do_it)");
  });

  it("merges applied scans (with student name, mode, result) and skips no-op scans", async () => {
    const { db, b, an, sat } = await setup();
    await scan(db, "2026-10-12T05:00:00", { sessionId: sat.id, studentId: an.id, actorId: b.glv.id });
    await scan(db, "2026-10-12T05:01:00", { sessionId: sat.id, studentId: an.id, actorId: b.glv.id, result: "noop" });
    await scan(db, "2026-10-12T05:02:00", { sessionId: sat.id, studentId: an.id, actorId: b.glv.id, kind: "undo" });
    const page = await listAuditLog(db, b.glv, ALL(b.classId));
    expect(page?.items.map((i) => [i.source, i.action, i.entity])).toEqual([["scan", "scan.undo", "scan"], ["scan", "scan.scan", "scan"]]);
    expect(page?.items[1].text).toBe("glv@x.vn quét thẻ An (chế độ Có mặt): chưa điểm danh → Có mặt (buổi 10/10)");
    expect(page?.items[1].at.toISOString()).toBe("2026-10-12T05:00:00.000Z");
  });
});

describe("listAuditLog filters", () => {
  async function mixed() {
    const s = await setup();
    const { db, b, an, sat, mass } = s;
    const day = { sessionDate: "2026-10-10", sessionKind: "class" };
    const massDay = { sessionDate: "2026-10-11", sessionKind: "mass" };
    await audit(db, "2026-10-12T01:00:00Z", { classId: b.classId, entity: "attendance", action: "attendance.bulk_present", summary: { count: 3, ...day } });
    await audit(db, "2026-10-12T02:00:00Z", { classId: b.classId, entity: "attendance", action: "attendance.bulk_present", summary: { count: 4, ...massDay } });
    await audit(db, "2026-10-12T03:00:00Z", { classId: b.classId, entity: "student", action: "student.create" });
    await audit(db, "2026-10-12T04:00:00Z", { classId: b.classId, entity: "seating_plan", action: "seating.create", summary: { planName: "S" } });
    await audit(db, "2026-10-12T05:00:00Z", { classId: b.classId, entity: "session", action: "session.cancel", summary: day });
    await audit(db, "2026-10-12T06:00:00Z", { classId: b.classId, entity: "session", action: "session.cancel", summary: massDay });
    await scan(db, "2026-10-12T07:00:00", { sessionId: sat.id, studentId: an.id });
    await scan(db, "2026-10-12T08:00:00", { sessionId: mass.id, studentId: an.id });
    return s;
  }
  const actions = async (db: Db, user: Parameters<typeof listAuditLog>[1], classId: string, group: string) =>
    (await listAuditLog(db, user, ALL(classId, { group })))!.items.map((i) => i.action);

  it.each([
    ["all", ["scan.scan", "scan.scan", "session.cancel", "session.cancel", "seating.create", "student.create", "attendance.bulk_present", "attendance.bulk_present"]],
    ["attendance", ["attendance.bulk_present"]],
    ["mass", ["scan.scan", "session.cancel", "attendance.bulk_present"]],
    ["student", ["student.create"]],
    ["seating", ["seating.create"]],
    ["session", ["session.cancel"]],
    ["scan", ["scan.scan", "scan.scan"]],
    ["unknown-group", null],
  ])("loại %s", async (group, expected) => {
    const { db, b } = await mixed();
    const got = await actions(db, b.glv, b.classId, group);
    expect(got).toEqual(expected ?? (await actions(db, b.glv, b.classId, "all")));
  });

  it("filters by Asia/Ho_Chi_Minh day bounds, both ends inclusive of the whole day", async () => {
    const { db, b } = await setup();
    const at = (iso: string, name: string) => audit(db, iso, { classId: b.classId, summary: { studentName: name } });
    await at("2026-10-11T16:59:59.999999Z", "cuối ngày 11");
    await at("2026-10-11T17:00:00Z", "đầu ngày 12");
    await at("2026-10-12T16:59:59.999999Z", "cuối ngày 12");
    await at("2026-10-12T17:00:00Z", "đầu ngày 13");
    const names = async (extra: object) => (await listAuditLog(db, b.glv, ALL(b.classId, extra)))!.items.map((i) => i.text.replace(/^.* em /, ""));
    expect(await names({ from: "2026-10-12", to: "2026-10-12" })).toEqual(["cuối ngày 12", "đầu ngày 12"]);
    expect(await names({ from: "2026-10-12" })).toEqual(["đầu ngày 13", "cuối ngày 12", "đầu ngày 12"]);
    expect(await names({ to: "2026-10-11" })).toEqual(["cuối ngày 11"]);
    expect(await names({ from: "2026-10-13", to: "2026-10-12" })).toEqual([]);
    expect(await names({ from: "garbage", to: "2026-02-31" })).toHaveLength(4); // ngày sai bị bỏ qua
  });

  it("applies the date range to scans too", async () => {
    const { db, b, an, sat } = await setup();
    await scan(db, "2026-10-11T16:59:00", { sessionId: sat.id, studentId: an.id });
    await scan(db, "2026-10-11T17:01:00", { sessionId: sat.id, studentId: an.id });
    expect((await listAuditLog(db, b.glv, ALL(b.classId, { from: "2026-10-12", to: "2026-10-12" })))!.items).toHaveLength(1);
  });
});

describe("listAuditLog keyset pagination over both sources", () => {
  it("pages through interleaved audit rows and scans with no gap or duplicate across page boundaries (limit 1..7)", async () => {
    const { db, b, an, sat } = await setup();
    // 12 dòng xen kẽ hai nguồn, gồm: cùng mili giây khác micro giây, và cùng chính xác một thời điểm.
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await audit(db, `2026-10-12T05:00:0${i}.123456Z`, { classId: b.classId }));
      ids.push(await scan(db, `2026-10-12T05:00:0${i}.123789`, { sessionId: sat.id, studentId: an.id }));
      ids.push(await audit(db, `2026-10-12T05:00:0${i}.123000Z`, { classId: b.classId }));
    }
    ids.push(await audit(db, "2026-10-12T05:00:09Z", { classId: b.classId }), await scan(db, "2026-10-12T05:00:09", { sessionId: sat.id, studentId: an.id }));
    const full = (await listAuditLog(db, b.glv, ALL(b.classId)))!;
    expect(full.items).toHaveLength(14);
    expect(full.nextCursor).toBeNull();
    // Thứ tự đúng: giảm dần theo (thời điểm đủ micro giây, id)
    const times = full.items.map((i) => i.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    for (const limit of [1, 2, 3, 5, 7, 13, 14]) {
      const got: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = (await listAuditLog(db, b.glv, ALL(b.classId, { limit, cursor })))!;
        expect(page.items.length).toBeLessThanOrEqual(limit);
        got.push(...page.items.map((i) => i.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(got, `limit ${limit}`).toEqual(full.items.map((i) => i.id));
      expect(new Set(got).size).toBe(14);
    }
  });

  it("orders rows with identical timestamps by id descending and pages across the tie", async () => {
    const { db, b } = await setup();
    const same = "2026-10-12T05:00:00.5Z";
    const ids = [await audit(db, same, { classId: b.classId }), await audit(db, same, { classId: b.classId }), await audit(db, same, { classId: b.classId })];
    const expected = [...ids].sort().reverse();
    const first = (await listAuditLog(db, b.glv, ALL(b.classId, { limit: 2 })))!;
    expect(first.items.map((i) => i.id)).toEqual(expected.slice(0, 2));
    const second = (await listAuditLog(db, b.glv, ALL(b.classId, { limit: 2, cursor: first.nextCursor })))!;
    expect(second.items.map((i) => i.id)).toEqual(expected.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the page when a row is added after the first page was read (keyset, not offset)", async () => {
    const { db, b } = await setup();
    for (let i = 0; i < 4; i++) await audit(db, `2026-10-12T05:00:0${i}Z`, { classId: b.classId });
    const first = (await listAuditLog(db, b.glv, ALL(b.classId, { limit: 2 })))!;
    await audit(db, "2026-10-12T06:00:00Z", { classId: b.classId }); // mới hơn trang đầu
    const second = (await listAuditLog(db, b.glv, ALL(b.classId, { limit: 2, cursor: first.nextCursor })))!;
    expect(second.items.map((i) => i.at.toISOString())).toEqual(["2026-10-12T05:00:01.000Z", "2026-10-12T05:00:00.000Z"]);
  });

  it("clamps the limit to 50, falls back to the first page on a malformed cursor and ignores a cursor from nowhere", async () => {
    const { db, b } = await setup();
    for (let i = 0; i < 60; i++) await audit(db, new Date(Date.UTC(2026, 9, 12, 5, 0, i)).toISOString(), { classId: b.classId });
    const big = (await listAuditLog(db, b.glv, ALL(b.classId, { limit: 500 })))!;
    expect(big.items).toHaveLength(50);
    expect(big.nextCursor).not.toBeNull();
    expect((await listAuditLog(db, b.glv, ALL(b.classId, { limit: 0 })))!.items).toHaveLength(1);
    expect((await listAuditLog(db, b.glv, ALL(b.classId, { limit: "x" })))!.items).toHaveLength(50);
    for (const bad of ["%%%", "e30", "x".repeat(400), 42, { a: 1 }]) {
      expect((await listAuditLog(db, b.glv, ALL(b.classId, { cursor: bad })))!.items.map((i) => i.id)).toEqual(big.items.map((i) => i.id));
    }
    const rest = (await listAuditLog(db, b.glv, ALL(b.classId, { cursor: big.nextCursor })))!;
    expect(rest.items).toHaveLength(10);
    expect(rest.nextCursor).toBeNull();
    // Mốc hợp lệ nhưng ở quá khứ xa: trang rỗng, không lỗi
    const old = encodeCursor({ at: "2000-01-01T00:00:00.000000Z", id: crypto.randomUUID() });
    expect((await listAuditLog(db, b.glv, ALL(b.classId, { cursor: old })))!.items).toEqual([]);
  });
});

describe("listAuditLog render safety", () => {
  it("never exposes raw summary JSON, a token or a full phone number in any item", async () => {
    const { db, b } = await setup();
    await audit(db, "2026-10-12T05:00:00Z", {
      classId: b.classId, action: "student.contact_update",
      summary: { studentName: "An", changed: ["parentPhone"], before: { parentPhone: null }, after: { parentPhone: "••••••567" }, secretStuff: "zzz" },
    });
    const [item] = (await listAuditLog(db, b.glv, ALL(b.classId)))!.items;
    expect(JSON.stringify(item)).not.toMatch(/secretStuff|zzz|0901/);
    expect(item.text).toContain("••••••567");
  });
});
