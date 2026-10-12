import { describe, expect, it } from "vitest";
import { decideScan, MASS_CANCELLED_SCAN, SESSION_CANCELLED } from "./scan-rules";
import { massScanHref, scanExit, scanModeFor, scanVariant } from "./scan-variant";

describe("scanVariant('class') keeps the class scanner exactly as it was", () => {
  const v = scanVariant("class");
  it("has both modes and the mode switch", () => {
    expect(v.modes).toEqual(["present", "late"]);
    expect(v.showModeSwitch).toBe(true);
    expect(v.confirmChoices).toEqual(["present", "late"]);
    expect(v.offersRemainingAbsent).toBe(true);
  });
  it("uses the class copy", () => {
    expect(v.title("2026-10-12")).toBe("Quét thẻ QR");
    expect(v.presentLabel).toBe("Có mặt");
    expect(v.appliedText("present")).toBe("Đã ghi Có mặt");
    expect(v.appliedText("late")).toBe("Đã ghi Đi muộn");
    expect(v.noopText("already_present")).toBe("Đã điểm danh");
    expect(v.noopText("already_late")).toBe("Đã ghi đi muộn");
    expect(v.unmarkedHeading(3)).toBe("Em chưa điểm danh (3)");
    expect(v.cancelledText).toBe(SESSION_CANCELLED);
    expect(v.exitLabel).toBe("Mở bảng điểm danh");
    expect(v.unmarkedNote).toBeNull();
    expect(v.confirmLabel("present")).toBe("Có mặt");
    expect(v.confirmLabel("late")).toBe("Đi muộn");
    expect(v.absentLabel("absent_excused")).toBe("Vắng có phép");
    expect(v.absentLabel("absent_unexcused")).toBe("Vắng không phép");
    expect(v.arrivedText).toBe("Em vừa đến, đổi thành:");
    expect(v.statusLabel("present")).toBeUndefined();
  });
});

describe("scanVariant('mass') — scanning at church", () => {
  const v = scanVariant("mass");
  it("has no late mode, no mode switch and no 'Đánh vắng còn lại'", () => {
    expect(v.modes).toEqual(["present"]);
    expect(v.showModeSwitch).toBe(false);
    expect(v.confirmChoices).toEqual(["present"]);
    expect(v.offersRemainingAbsent).toBe(false);
  });
  it("says 'Đi lễ' and names the Sunday in the title", () => {
    expect(v.title("2026-10-11")).toBe("Điểm danh đi lễ — Chúa nhật 11/10");
    expect(v.title("2026-12-08")).toBe("Điểm danh đi lễ — Ngày lễ 08/12");
    expect(v.presentLabel).toBe("Đi lễ");
    expect(v.appliedText("present")).toBe("Đã ghi Đi lễ");
    expect(v.noopText("already_present")).toBe("Đã ghi đi lễ");
    expect(v.unmarkedHeading(2)).toBe("Em chưa quét (2)");
    expect(v.unmarkedNote).toBe("Em chưa quét sẽ được tính là chưa đi lễ trong tuần đã ghi.");
    expect(v.cancelledText).toBe(MASS_CANCELLED_SCAN);
    expect(v.exitLabel).toBe("Về trang lớp");
    expect(v.confirmLabel("present")).toBe("Có đi lễ");
    expect(v.absentLabel("absent_excused")).toBe("Không đi lễ có phép");
    expect(v.absentLabel("absent_unexcused")).toBe("Không đi lễ không phép");
    expect(v.arrivedText).toBe("Em có mặt ở nhà thờ, đổi thành:");
    expect(v.statusLabel("present")).toBe("Đi lễ");
    expect(v.statusLabel("absent_unexcused")).toBe("Không đi lễ");
    expect(v.statusLabel(null)).toBeUndefined();
  });
});

describe("scanModeFor", () => {
  it("keeps the remembered mode on a class session", () => {
    expect(scanModeFor("class", "late")).toBe("late");
    expect(scanModeFor("class", "present")).toBe("present");
  });
  it("is always 'present' on a Mass session, so decideScan never produces late there", () => {
    expect(scanModeFor("mass", "late")).toBe("present");
    expect(decideScan(null, scanModeFor("mass", "late"))).toEqual({ kind: "apply", status: "present" });
    expect(decideScan({ status: "absent_unexcused", reason: null }, scanModeFor("mass", "late")))
      .toEqual({ kind: "confirm", defaultStatus: "present", current: "absent_unexcused" });
  });
});

describe("scanExit: the exit button and the leave-guard wording always name the same place", () => {
  it("class scanner: always the attendance board", () => {
    expect(scanExit("class", false)).toEqual({ label: "Mở bảng điểm danh", place: "bảng điểm danh" });
    expect(scanExit("class", true)).toEqual({ label: "Mở bảng điểm danh", place: "bảng điểm danh" });
  });
  it("mass scanner: the class page, or back to the board when opened from it", () => {
    expect(scanExit("mass", false)).toEqual({ label: "Về trang lớp", place: "trang lớp" });
    expect(scanExit("mass", true)).toEqual({ label: "Về bảng điểm danh", place: "bảng điểm danh" });
  });
});

describe("massScanHref", () => {
  it("keeps manual and from=board so re-login returns to the same scanner", () => {
    expect(massScanHref("c1", "2026-10-11", { manual: false, fromBoard: false })).toBe("/lop/c1/di-le/2026-10-11/quet");
    expect(massScanHref("c1", "2026-10-11", { manual: false, fromBoard: true })).toBe("/lop/c1/di-le/2026-10-11/quet?from=board");
    expect(massScanHref("c1", "2026-12-08", { manual: true, fromBoard: true })).toBe("/lop/c1/di-le/2026-12-08/quet?manual=1&from=board");
  });
});
