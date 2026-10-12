import { describe, expect, it } from "vitest";
import { cameraProblem } from "./scan-camera-message";

describe("cameraProblem", () => {
  it("camera đang chạy/đang mở: không có thông báo", () => {
    for (const s of ["starting", "on", "restarting"] as const) expect(cameraProblem(s)).toBeNull();
  });

  it("bị từ chối quyền: chỉ cách mở trong Cài đặt iPhone, không có nút mở lại", () => {
    const p = cameraProblem("denied")!;
    expect(p.title).toBe("Chưa cho phép dùng camera");
    expect(p.body).toContain("Cài đặt > Safari > Camera");
    expect(p.body).toContain("tìm tên");
    expect(p.canReopen).toBe(false);
  });

  it("camera bận/tắt: cho mở lại", () => {
    const p = cameraProblem("unavailable")!;
    expect(p.title).toBe("Không mở được camera");
    expect(p.canReopen).toBe(true);
  });

  it("không nạp được bộ đọc mã (WASM bị chặn/iOS cũ/mất mạng): nói iOS 16+, hướng tới Tìm bằng tên, cho thử lại", () => {
    const p = cameraProblem("decoder-failed")!;
    expect(p.title).toBe("Máy này chưa đọc được mã QR");
    expect(p.body).toContain("iOS 16");
    expect(p.body).toContain("Cập nhật phần mềm");
    expect(p.body).toContain("Tìm bằng tên");
    expect(p.canReopen).toBe(true);
  });
});
