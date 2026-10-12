import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, type AuditAction } from "./events";
import { DELETED_ACTOR, describeAuditEvent, describeScanEvent } from "./describe";

const day = { sessionDate: "2026-10-12", sessionKind: "class" };
const mass = { sessionDate: "2026-10-11", sessionKind: "mass" };
const text = (action: string, summary: Record<string, unknown>, actorName: string | null = "GLV An") =>
  describeAuditEvent({ action, actorName, summary }).text;

const CASES: [AuditAction, Record<string, unknown>, string][] = [
  ["attendance.set", { studentName: "Nguyễn Văn B", ...day, before: { status: "present", reason: null }, after: { status: "absent_unexcused", reason: null } },
    "GLV An đổi Nguyễn Văn B: Có mặt → Vắng không phép (buổi 12/10)"],
  ["attendance.set", { studentName: "Bình", ...day, before: null, after: { status: "absent_excused", reason: "Ốm" } },
    "GLV An điểm danh Bình: Vắng có phép, lý do: Ốm (buổi 12/10)"],
  ["attendance.set", { studentName: "Bình", ...day, before: { status: "late", reason: "Kẹt xe" }, after: null },
    "GLV An xoá điểm danh của Bình, trước đó: Đi muộn, lý do: Kẹt xe (buổi 12/10)"],
  ["attendance.set", { studentName: "Bình", ...mass, before: null, after: { status: "present", reason: null } },
    "GLV An ghi đi lễ cho Bình: Có mặt (đi lễ 11/10)"],
  ["attendance.bulk_present", { count: 12, batchId: "b", ...day }, "GLV An bấm \"Tất cả có mặt\": 12 em (buổi 12/10)"],
  ["attendance.bulk_present", { count: 9, batchId: "b", ...mass }, "GLV An bấm \"Cả lớp đi lễ\": 9 em (đi lễ 11/10)"],
  ["attendance.bulk_undo", { count: 12, batchId: "b", ...day }, "GLV An hoàn tác \"Tất cả có mặt\": 12 em (buổi 12/10)"],
  ["attendance.bulk_undo", { count: 9, batchId: "b", ...mass }, "GLV An hoàn tác \"Cả lớp đi lễ\": 9 em (đi lễ 11/10)"],
  ["attendance.remaining_absent", { count: 3, ...day }, "GLV An đánh vắng không phép các em còn lại: 3 em (buổi 12/10)"],
  ["student.create", { studentName: "Cường" }, "GLV An thêm em Cường"],
  ["student.update", { studentName: "Cường", changed: ["fullName", "birthDate"], before: { fullName: "Cuong" }, after: { fullName: "Cường" } },
    "GLV An sửa thông tin của Cường: tên (Cuong → Cường), ngày sinh"],
  ["student.update", { studentName: "Cường", changed: ["parentPhone", "note"], before: { parentPhone: null }, after: { parentPhone: "••••••567" } },
    "GLV An sửa thông tin của Cường: SĐT phụ huynh (chưa có → ••••••567), ghi chú"],
  ["student.contact_update", { studentName: "Cường", changed: ["parentPhone"], before: { parentPhone: "••••••111" }, after: { parentPhone: "••••••567" } },
    "GLV An cập nhật liên hệ của Cường: SĐT phụ huynh (••••••111 → ••••••567)"],
  ["student.deactivate", { studentName: "Cường" }, "GLV An cho Cường nghỉ học (ẩn khỏi danh sách)"],
  ["student.reactivate", { studentName: "Cường" }, "GLV An cho Cường học lại (hiện lại trong danh sách)"],
  ["student.import", { count: 20, skipped: 2 }, "GLV An nhập 20 em từ tệp (bỏ qua 2 dòng trùng)"],
  ["student.import", { count: 20, skipped: 0 }, "GLV An nhập 20 em từ tệp"],
  ["student.qr_rotate", { studentName: "Cường" }, "GLV An đổi thẻ QR của Cường"],
  ["seating.create", { planName: "Sơ đồ mới", templateId: null, active: true }, "GLV An tạo sơ đồ \"Sơ đồ mới\""],
  ["seating.apply_template", { planName: "Sơ đồ 1", templateId: "rows" }, "GLV An áp dụng mẫu cho sơ đồ \"Sơ đồ 1\""],
  ["seating.save_layout", { planName: "Sơ đồ 1", seatsKept: 10, seatsRemoved: 2 }, "GLV An lưu bố cục sơ đồ \"Sơ đồ 1\" (giữ 10 chỗ, bỏ 2 chỗ)"],
  ["seating.save_layout", { planName: "Sơ đồ 1", seatsKept: 10, seatsRemoved: 0 }, "GLV An lưu bố cục sơ đồ \"Sơ đồ 1\" (giữ 10 chỗ)"],
  ["seating.activate", { planName: "Sơ đồ 1" }, "GLV An đặt sơ đồ \"Sơ đồ 1\" làm sơ đồ đang dùng"],
  ["seating.delete", { planName: "Sơ đồ 1" }, "GLV An xoá sơ đồ \"Sơ đồ 1\""],
  ["session.cancel", day, "GLV An đánh dấu nghỉ lễ buổi học 12/10"],
  ["session.cancel", mass, "GLV An đánh dấu nghỉ đi lễ 11/10"],
  ["session.reopen", day, "GLV An mở lại buổi học 12/10"],
  ["session.reopen", mass, "GLV An mở lại đi lễ 11/10"],
  ["grade.mass_threshold", { gradeName: "Khối 1", before: 2, after: 3 }, "GLV An đổi ngưỡng cảnh báo đi lễ của Khối 1: 2 → 3 lần vắng"],
  ["grade.next_grade", { gradeName: "Khối 1", before: null, after: "Khối 2" }, "GLV An đặt khối kế tiếp của Khối 1: chưa có → Khối 2"],
  ["grade.next_grade", { gradeName: "Khối 1", before: "Khối 2", after: null }, "GLV An đặt khối kế tiếp của Khối 1: Khối 2 → chưa có"],
  ["school_year.create", { yearName: "2027-2028", term1Start: "2027-09-01", term2End: "2028-05-31" },
    "GLV An tạo năm học 2027-2028 (01/09/2027 – 31/05/2028)"],
  ["school_year.delete", { yearName: "2027-2028" }, "GLV An xoá năm học 2027-2028"],
  ["promotion.apply", { fromClass: "Lớp A", toClass: "Lớp B", count: 12, skipped: 0, seatsRemoved: 10 },
    "GLV An chuyển 12 em từ Lớp A sang Lớp B (bỏ 10 chỗ ngồi ở lớp cũ)"],
  ["promotion.apply", { fromClass: "Lớp A", toClass: "Lớp B", count: 2, skipped: 1, seatsRemoved: 0 },
    "GLV An chuyển 2 em từ Lớp A sang Lớp B (1 em đã ở lớp mới)"],
  ["promotion.undo", { fromClass: "Lớp A", toClass: "Lớp B", restored: 11, notRestored: 1 },
    "GLV An hoàn tác lên lớp Lớp A → Lớp B: trả 11 em về lớp cũ, 1 em không trả được"],
  ["promotion.apply", { fromClass: "Lớp A", toClass: "Lớp B", count: 2, direction: "in" }, "GLV An chuyển 2 em vào Lớp B (từ Lớp A)"],
  ["promotion.undo", { fromClass: "Lớp A", toClass: "Lớp B", restored: 2, notRestored: 0, direction: "in" }, "GLV An hoàn tác lên lớp: 2 em rời Lớp B, về lại Lớp A"],
  ["promotion.undo", { fromClass: "Lớp A", toClass: "Lớp B", restored: 2, notRestored: 0 },
    "GLV An hoàn tác lên lớp Lớp A → Lớp B: trả 2 em về lớp cũ"],
  ["class.schedule", { className: "Lớp A", before: null, after: "Chủ nhật 08:00" }, "GLV An đổi lịch học của Lớp A: chưa đặt → Chủ nhật 08:00"],
  ["class.schedule", { className: "Lớp A", before: "Chủ nhật 08:00", after: "Thứ bảy 17:30" }, "GLV An đổi lịch học của Lớp A: Chủ nhật 08:00 → Thứ bảy 17:30"],
  ["class.schedule", { className: "Lớp A", before: "Chủ nhật 08:00", after: null }, "GLV An xoá lịch học của Lớp A (trước đó: Chủ nhật 08:00)"],
  ["class.schedule", {}, "GLV An đổi lịch học"],
];

describe("describeAuditEvent", () => {
  it.each(CASES)("%s -> sentence", (action, summary, expected) => {
    expect(text(action, summary)).toBe(expected);
  });

  it("covers every action of the union with at least one case", () => {
    const covered = new Set(CASES.map(([a]) => a));
    for (const action of Object.keys(AUDIT_ACTIONS)) expect(covered.has(action as AuditAction), action).toBe(true);
  });

  it("returns the actor and the rest separately, and names a deleted account", () => {
    const d = describeAuditEvent({ action: "student.create", actorName: null, summary: { studentName: "An" } });
    expect(d.actor).toBe(DELETED_ACTOR);
    expect(d.actor).toBe("Tài khoản đã xoá");
    expect(d.text).toBe("Tài khoản đã xoá thêm em An");
    expect(d.what).toBe("thêm em An");
  });

  it("falls back to a generic line for an unknown or legacy action", () => {
    expect(text("student.teleport", { studentName: "An" })).toBe("GLV An thực hiện một thay đổi (student.teleport)");
    expect(text("", {})).toBe("GLV An thực hiện một thay đổi");
  });

  it("is tolerant of missing or malformed summary fields and never throws", () => {
    expect(text("attendance.set", {})).toBe("GLV An điểm danh một em: (không rõ trạng thái)");
    expect(text("attendance.set", { studentName: 5, before: "x", after: [] })).toContain("GLV An");
    expect(text("student.create", {})).toBe("GLV An thêm một em");
    expect(text("attendance.bulk_present", { count: "x", sessionDate: "không phải ngày" })).toBe("GLV An bấm \"Tất cả có mặt\"");
    expect(text("session.cancel", {})).toBe("GLV An đánh dấu nghỉ lễ một buổi học");
    expect(text("grade.mass_threshold", {})).toBe("GLV An đổi ngưỡng cảnh báo đi lễ");
    expect(text("grade.next_grade", {})).toBe("GLV An đặt khối kế tiếp");
    expect(text("school_year.create", {})).toBe("GLV An tạo năm học mới");
    expect(text("school_year.delete", {})).toBe("GLV An xoá một năm học");
    expect(text("promotion.apply", {})).toBe("GLV An chuyển em sang lớp khác");
    expect(text("promotion.undo", {})).toBe("GLV An hoàn tác một lượt lên lớp");
  });

  it("prints an already-masked phone as is and masks a legacy unmasked phone or card token that slipped into a stored summary", () => {
    expect(text("student.update", { studentName: "An", changed: ["parentPhone"], before: { parentPhone: null }, after: { parentPhone: "••••••567" } })).toContain("••••••567");
    const leaked = describeAuditEvent({ action: "attendance.set", actorName: "GLV An", summary: {
      studentName: "An", ...day, before: null, after: { status: "absent_excused", reason: "gọi mẹ 0901234567 mã dd1.0123456789abcdef0123456789abcdef" },
    } }).text;
    expect(leaked).not.toMatch(/0901234567|0123456789abcdef/);
    expect(leaked).toContain("••••••567");
  });

  it("does not render raw JSON: unknown summary keys are never printed", () => {
    expect(text("student.create", { studentName: "An", secretThing: "zzz", extra: { a: 1 } })).toBe("GLV An thêm em An");
  });
});

describe("describeScanEvent", () => {
  const base = { actorName: "GLV An", studentName: "Bình", sessionDate: "2026-10-12", sessionKind: "class" };
  it.each([
    [{ kind: "scan", mode: "present", prevStatus: null, newStatus: "present" }, "GLV An quét thẻ Bình (chế độ Có mặt): chưa điểm danh → Có mặt (buổi 12/10)"],
    [{ kind: "scan", mode: "late", prevStatus: "absent_unexcused", newStatus: "late" }, "GLV An quét thẻ Bình (chế độ Đi muộn): Vắng không phép → Đi muộn (buổi 12/10)"],
    [{ kind: "manual", mode: "present", prevStatus: null, newStatus: "present" }, "GLV An chọn tên Bình ở màn quét thẻ (chế độ Có mặt): chưa điểm danh → Có mặt (buổi 12/10)"],
    [{ kind: "undo", mode: null, prevStatus: "present", newStatus: null }, "GLV An hoàn tác lượt quét của Bình: Có mặt → chưa điểm danh (buổi 12/10)"],
  ])("%j", (scan, expected) => {
    expect(describeScanEvent({ ...base, ...scan }).text).toBe(expected);
  });

  it("uses the mass label for a mass session and the deleted-account name", () => {
    const d = describeScanEvent({ ...base, actorName: null, sessionKind: "mass", sessionDate: "2026-10-11", kind: "scan", mode: "present", prevStatus: null, newStatus: "present" });
    expect(d.text).toBe("Tài khoản đã xoá quét thẻ Bình (chế độ Có mặt): chưa điểm danh → Có mặt (đi lễ 11/10)");
  });

  it("copes with a missing student name", () => {
    expect(describeScanEvent({ ...base, studentName: null, kind: "scan", mode: "present", prevStatus: null, newStatus: "present" }).text)
      .toContain("quét thẻ một em");
  });
});
