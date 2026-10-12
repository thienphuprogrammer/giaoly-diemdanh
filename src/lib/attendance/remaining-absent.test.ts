import { describe, expect, it } from "vitest";
import { deviceUnsentNotice, remainingAbsentBlock, unmarkedStudents } from "./remaining-absent";

describe("unmarkedStudents", () => {
  const students = [{ id: "a", fullName: "An" }, { id: "b", fullName: "Bình" }, { id: "c", fullName: "Chi" }];
  it("lists students without a mark, keeping order", () => {
    expect(unmarkedStudents(students, { a: { status: "present", reason: null }, b: null }).map((s) => s.id)).toEqual(["b", "c"]);
  });
  it("is empty when everyone has a mark", () => {
    expect(unmarkedStudents(students, { a: { status: "late", reason: null }, b: { status: "absent_excused", reason: null }, c: { status: "present", reason: null } })).toEqual([]);
  });
});

describe("remainingAbsentBlock", () => {
  it("is null when nothing is unsaved", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: false })).toBeNull();
  });
  it("explains why while saves or scans are unfinished", () => {
    expect(remainingAbsentBlock({ unsaved: 3, busy: false })).toMatch(/3 lượt/);
  });
  it("explains why while another bulk action runs", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: true })).toMatch(/đang lưu/i);
  });
  it("blocks while data is stale or not loaded", () => {
    expect(remainingAbsentBlock({ unsaved: 0, busy: false, notReady: true })).not.toBeNull();
  });
  it("blocks while this device still holds unsent scans for the session, with the count", () => {
    const reason = remainingAbsentBlock({ unsaved: 0, busy: false, deviceUnsent: 2 });
    expect(reason).toMatch(/2 lượt quét chưa gửi/);
    expect(reason).toMatch(/màn quét/);
  });
  it("adds device scans to the board's own unsaved taps", () => {
    expect(remainingAbsentBlock({ unsaved: 1, busy: false, deviceUnsent: 2 })).toMatch(/2 lượt quét chưa gửi/);
    expect(remainingAbsentBlock({ unsaved: 0, busy: false, deviceUnsent: 0 })).toBeNull();
  });
});

describe("deviceUnsentNotice", () => {
  it("is null when nothing is queued on this device", () => {
    expect(deviceUnsentNotice(0)).toBeNull();
  });
  it("tells how many scans are unsent and to open the scanner", () => {
    expect(deviceUnsentNotice(3)).toBe("3 lượt quét chưa gửi — mở màn quét để gửi");
  });
});
