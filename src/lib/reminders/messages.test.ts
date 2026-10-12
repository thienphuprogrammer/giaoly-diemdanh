import { describe, expect, it } from "vitest";
import { buildPushPayload } from "@/lib/push/payload";
import { classReminderKey, classReminderMessage, thresholdKey, thresholdMessage } from "./messages";

const ID = "6f1c2a7e-0d3b-4c5e-9f8a-1b2c3d4e5f60";
const TERM = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("khoá nhật ký", () => {
  it("nhắc lớp: lớp + ngày; ngưỡng: em + học kỳ", () => {
    expect(classReminderKey(ID, "2026-10-11")).toBe(`${ID}:2026-10-11`);
    expect(thresholdKey(ID, TERM)).toBe(`${ID}:${TERM}`);
  });
});

describe("classReminderMessage", () => {
  it("chỉ tên lớp, đường dẫn tới trang điểm danh hôm nay", () => {
    expect(classReminderMessage({ id: ID, name: "Lớp Ấu 1A" }, "2026-10-11")).toEqual({
      title: "Chưa điểm danh",
      body: "Lớp Ấu 1A chưa điểm danh hôm nay",
      url: `/lop/${ID}/diem-danh/2026-10-11`,
    });
  });

  it("tên lớp chưa có chữ \"Lớp\" thì thêm vào", () => {
    expect(classReminderMessage({ id: ID, name: "Ấu 1A" }, "2026-10-11").body).toBe("Lớp Ấu 1A chưa điểm danh hôm nay");
    expect(classReminderMessage({ id: ID, name: "lớp Thêm Sức" }, "2026-10-11").body).toBe("lớp Thêm Sức chưa điểm danh hôm nay");
    expect(thresholdMessage("absence_threshold", ["Ấu 1A"]).body).toBe("Có 1 em đạt ngưỡng cảnh báo vắng học (Lớp Ấu 1A)");
  });

  it("đường dẫn qua được kiểm tra cùng nguồn của payload", () => {
    const json = JSON.parse(buildPushPayload(classReminderMessage({ id: ID, name: "Lớp A" }, "2026-10-11"))) as { url: string };
    expect(json.url).toBe(`/lop/${ID}/diem-danh/2026-10-11`);
  });
});

describe("thresholdMessage", () => {
  it("một em, một lớp: số lượng và tên lớp, không tên em", () => {
    expect(thresholdMessage("absence_threshold", ["Lớp A"])).toEqual({
      title: "Cảnh báo vắng học",
      body: "Có 1 em đạt ngưỡng cảnh báo vắng học (Lớp A)",
      url: "/can-chu-y",
    });
    expect(thresholdMessage("mass_threshold", ["Lớp A"]).body).toBe("Có 1 em đạt ngưỡng cảnh báo vắng lễ (Lớp A)");
    expect(thresholdMessage("mass_threshold", ["Lớp A"]).title).toBe("Cảnh báo vắng lễ");
  });

  it("gộp nhiều em: đếm theo em, tên lớp không lặp và theo thứ tự tiếng Việt", () => {
    expect(thresholdMessage("absence_threshold", ["Lớp B", "Lớp A", "Lớp B"]).body)
      .toBe("Có 3 em đạt ngưỡng cảnh báo vắng học ở Lớp A, Lớp B");
  });

  it("quá nhiều lớp thì rút gọn", () => {
    const names = Array.from({ length: 8 }, (_, i) => `Lớp ${i + 1}`);
    expect(thresholdMessage("mass_threshold", names).body)
      .toBe("Có 8 em đạt ngưỡng cảnh báo vắng lễ ở Lớp 1, Lớp 2, Lớp 3, Lớp 4 và 4 lớp khác");
  });
});
