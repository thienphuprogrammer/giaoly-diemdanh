import { describe, expect, it } from "vitest";
import { lockBodyScroll } from "./body-scroll-lock";

describe("khóa cuộn các hộp thoại", () => {
  it.each([true, false])("giữ khóa đến khi cả hai hộp đóng, dù thứ tự đóng đảo: %s", (inOrder) => {
    const body = { style: { overflow: "" } };
    const first = lockBodyScroll(body);
    const second = lockBodyScroll(body);
    (inOrder ? first : second)();
    expect(body.style.overflow).toBe("hidden");
    (inOrder ? second : first)();
    expect(body.style.overflow).toBe("");
  });

  it("khôi phục trạng thái sẵn có và cho phép dọn dẹp lặp lại", () => {
    const body = { style: { overflow: "scroll" } };
    const release = lockBodyScroll(body);
    release();
    release();
    expect(body.style.overflow).toBe("scroll");
    const next = lockBodyScroll(body);
    expect(body.style.overflow).toBe("hidden");
    next();
    expect(body.style.overflow).toBe("scroll");
  });
});
