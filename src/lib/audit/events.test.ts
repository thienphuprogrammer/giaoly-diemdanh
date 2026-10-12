import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_SUMMARY_MAX_BYTES, AuditSummaryError, entityOf, isAuditAction, maskPhone, redactText, sanitizeSummary,
} from "./events";

// Giá trị mẫu dựng lúc chạy (không có hằng số giống bí mật trong mã nguồn).
const hex32 = (seed: string) => seed.repeat(32).slice(0, 32);
const sampleToken = hex32("a1b2c3d4e5f6");
const samplePayload = `dd1.${sampleToken}`;

describe("audit action table", () => {
  it("maps every action to one of the allowed entities, with the action prefix matching its entity", () => {
    const prefix: Record<string, string> = {
      attendance: "attendance", student: "student", seating_plan: "seating", session: "session", grade_settings: "grade",
      school_year: "school_year", promotion: "promotion",
    };
    for (const [action, entity] of Object.entries(AUDIT_ACTIONS)) {
      expect(AUDIT_ENTITIES).toContain(entity);
      expect(action.split(".")[0]).toBe(prefix[entity]);
    }
  });

  it("knows the actions of the spec and nothing for unknown names", () => {
    for (const a of [
      "attendance.set", "attendance.bulk_present", "attendance.bulk_undo", "attendance.remaining_absent",
      "student.create", "student.update", "student.deactivate", "student.reactivate", "student.import", "student.contact_update", "student.qr_rotate",
      "seating.create", "seating.apply_template", "seating.save_layout", "seating.activate", "seating.delete",
      "session.cancel", "session.reopen", "grade.mass_threshold", "grade.next_grade",
      "school_year.create", "school_year.delete", "promotion.apply", "promotion.undo",
    ]) expect(isAuditAction(a)).toBe(true);
    expect(isAuditAction("student.drop_table")).toBe(false);
    expect(isAuditAction("toString")).toBe(false);
    expect(entityOf("seating.create")).toBe("seating_plan");
    expect(entityOf("promotion.apply")).toBe("promotion");
    expect(entityOf("school_year.create")).toBe("school_year");
  });
});

describe("maskPhone", () => {
  it.each([
    ["0901234567", "••••••567"],
    ["0901 234 567", "••••••567"],
    ["+84 90.123.4567", "••••••567"],
    ["12", "••••••"],
  ])("%s -> %s", (raw, masked) => {
    expect(maskPhone(raw)).toBe(masked);
  });

  it("is null for missing or empty numbers", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone("   ")).toBeNull();
  });
});

describe("redactText", () => {
  it("hides card tokens, card payloads and phone-like digit runs inside free text", () => {
    expect(redactText(`thẻ ${samplePayload} mất`)).toBe("thẻ [ẩn] mất");
    expect(redactText(`mã ${sampleToken}`)).toBe("mã [ẩn]");
    expect(redactText("gọi mẹ 0901 234 567 nhé")).toBe("gọi mẹ ••••••567 nhé");
    expect(redactText("gọi +84901234567")).toBe("gọi ••••••567");
  });

  it.each([
    ["090-123-4567", "••••••567"],
    ["0901-234-567", "••••••567"],
    ["+84-90-123-4567", "••••••567"],
    ["(090) 1234567", "••••••567"],
    ["sdt0901234567", "••••••567"],
    ["SDT:0901234567", "SDT:••••••567"],
    ["84901234567", "••••••567"],
    ["sdt-0901234567", "sdt-••••••567"],
    ["SĐT-0901234567", "SĐT-••••••567"],
    ["mẹ-0901234567", "mẹ-••••••567"],
    ["0901/234/567", "••••••567"],
    ["0901–234–567", "••••••567"],
    ["+84 (0) 90 123 4567", "••••••567"],
  ])("masks phone-shaped %s", (raw, masked) => {
    expect(redactText(raw)).toBe(masked);
    expect(redactText(`gọi mẹ ${raw} nhé`)).toContain("••••••567");
    expect(redactText(`gọi mẹ ${raw} nhé`)).not.toMatch(/0901|123|90-/);
  });

  it("masks an old 11-digit landline", () => {
    expect(redactText("máy bàn 0236 3822 123")).toBe("máy bàn ••••••123");
    expect(redactText("028 3822 1234")).toBe("••••••234");
  });

  it.each([
    "2026-10-12", "ngày 2026-10-12", "12 em", "2 tuần", "đã nghỉ 12345678 lần", "buổi 12/10", "Khối 1 - Lớp 2A",
    "12345678-1234-4123-8123-123456789012", "f0123456789e", "id-e09012345678", "2026-10-12 2026-10-13",
    "08-10-2026", "05.10.2026", "08 10 2026", "ngày 05.10.2026 12", "05/10/2026", "mã HS 00012345", "0 1 2 3 4 5 6 7", "0123456",
    "a1b2c3d4-0901234567ab", "0b1c2d3e-0901234567",
  ])("keeps %s untouched", (text) => {
    expect(redactText(text)).toBe(text);
    expect(() => sanitizeSummary({ note: text })).not.toThrow();
  });

  it("rejects phone-shaped strings with separators or a letter prefix in summaries", () => {
    for (const bad of ["090-123-4567", "(090) 1234567", "sdt0901234567", "+84-90-123-4567"]) {
      expect(() => sanitizeSummary({ note: bad })).toThrow(AuditSummaryError);
    }
  });

  it("keeps ordinary text, dates and short numbers", () => {
    expect(redactText("Ốm, nghỉ 2 buổi từ 2026-10-04")).toBe("Ốm, nghỉ 2 buổi từ 2026-10-04");
    expect(redactText("Phêrô Nguyễn Văn An")).toBe("Phêrô Nguyễn Văn An");
  });
});

describe("sanitizeSummary", () => {
  it("accepts primitives, arrays of primitives and nested plain objects, returning a copy", () => {
    const input = { studentName: "An", count: 3, ok: true, none: null, ids: ["a", "b"], before: { status: "present", reason: null } };
    const out = sanitizeSummary(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.before).not.toBe(input.before);
  });

  it.each([
    ["qr_token", { qr_token: "x" }],
    ["qrToken", { qrToken: "x" }],
    ["token", { token: "x" }],
    ["payload", { payload: "x" }],
    ["password", { password: "x" }],
    ["nested token", { after: { Token: "x" } }],
    ["cardToken", { cardToken: "x" }],
    ["refresh_token_hash", { refresh_token_hash: "x" }],
    ["clientSecret", { clientSecret: "x" }],
    ["SECRET_KEY", { SECRET_KEY: "x" }],
    ["passwordHash", { passwordHash: "x" }],
    ["rawPayloadJson", { rawPayloadJson: "x" }],
    ["nested secretValue", { before: { secretValue: "x" } }],
  ])("rejects a forbidden key (%s)", (_name, summary) => {
    expect(() => sanitizeSummary(summary)).toThrow(AuditSummaryError);
  });

  it("rejects card tokens and payloads anywhere in values", () => {
    expect(() => sanitizeSummary({ note: samplePayload })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ note: `x ${sampleToken.toUpperCase()} y` })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ list: [sampleToken] })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ after: { note: sampleToken } })).toThrow(AuditSummaryError);
  });

  it("accepts dashed uuids (batch/session ids) which are not card tokens", () => {
    expect(() => sanitizeSummary({ batchId: crypto.randomUUID() })).not.toThrow();
    expect(() => sanitizeSummary({ sessionId: "12345678-1234-4123-8123-123456789012" })).not.toThrow(); // đoạn toàn số của UUID
  });

  it("requires phone fields to be masked and rejects unmasked phone-like digits anywhere", () => {
    expect(sanitizeSummary({ parentPhone: maskPhone("0901234567") })).toEqual({ parentPhone: "••••••567" });
    expect(sanitizeSummary({ before: { parentPhone: null } })).toEqual({ before: { parentPhone: null } });
    expect(() => sanitizeSummary({ parentPhone: "0901234567" })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ phone: "••••••567x" })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ reason: "gọi 0901 234 567" })).toThrow(AuditSummaryError);
  });

  it("rejects non-plain shapes: arrays/strings at the top, class instances, functions, deep nesting, objects in arrays, NaN", () => {
    for (const bad of [[], "x", null, new Date(), new Map()]) expect(() => sanitizeSummary(bad)).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ at: new Date() })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ f: () => 1 })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ a: { b: { c: 1 } } })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ list: [{ a: 1 }] })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ n: Number.NaN })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ u: undefined })).toThrow(AuditSummaryError);
  });

  it(`rejects summaries over ${AUDIT_SUMMARY_MAX_BYTES} bytes (UTF-8)`, () => {
    expect(() => sanitizeSummary({ s: "a".repeat(AUDIT_SUMMARY_MAX_BYTES) })).toThrow(AuditSummaryError);
    expect(() => sanitizeSummary({ s: "ệ".repeat(700) })).toThrow(AuditSummaryError); // 3 byte mỗi ký tự
    expect(() => sanitizeSummary({ s: "a".repeat(1000) })).not.toThrow();
  });

  it("never echoes the offending value in the error message", () => {
    try {
      sanitizeSummary({ note: samplePayload });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(sampleToken);
    }
  });
});

describe("redactText cost", () => {
  it.each([
    ["digits", "0".repeat(32_000)], ["spaced zeros", "0 ".repeat(16_000)], ["dashed", "0-".repeat(16_000)],
    ["parens", "(0".repeat(16_000)], ["letters", "a".repeat(32_000)], ["prefix + zeros", `sdt${"0 ".repeat(15_000)}`],
    ["84 runs", "84".repeat(16_000)], ["seps", "0".concat(" ".repeat(32_000), "1")],
  ])("is fast on adversarial input (%s)", (_n, input) => {
    const t = performance.now();
    redactText(input);
    try { sanitizeSummary({ note: input }); } catch { /* chỉ đo thời gian: nội dung có thể bị từ chối */ }
    expect(performance.now() - t).toBeLessThan(150);
  });
});
