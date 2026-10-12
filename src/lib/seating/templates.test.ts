import { describe, expect, it } from "vitest";
import { parseLayout, seatsOf } from "./layout";
import { buildTemplateLayout, capacityStatus, TEMPLATES, templateCapacity } from "./templates";

const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const EXPECTED: Record<string, { capacity: number; rows: number }> = {
  "lop-nho-2-day": { capacity: 24, rows: 4 },
  "vua-3-day": { capacity: 36, rows: 4 },
  "hang-dau-nho": { capacity: 44, rows: 4 },
  "chu-u": { capacity: 24, rows: 4 },
  "nhom-bang-dai": { capacity: 24, rows: 2 },
  "truyen-thong-3-day": { capacity: 50, rows: 5 },
};

describe("TEMPLATES", () => {
  it("lists the six templates in order with unique slugs and non-empty copy", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(Object.keys(EXPECTED));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.name).not.toBe("");
      expect(t.description).not.toBe("");
      expect(t.classSize).not.toBe("");
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s builds a valid layout with the expected capacity", (id, t) => {
    const layout = buildTemplateLayout(id, counter());
    expect(layout).not.toBeNull();
    expect(parseLayout(layout).ok).toBe(true);
    expect(layout).toHaveLength(EXPECTED[id].rows);
    expect(templateCapacity(t)).toBe(EXPECTED[id].capacity);
    expect(seatsOf(layout!)).toHaveLength(EXPECTED[id].capacity);
  });

  it("shapes the layouts as specified", () => {
    const shape = (id: string) =>
      buildTemplateLayout(id, counter())!.map((r) => r.items.map((i) => (i.type === "gap" ? "g" : i.seats)));
    expect(shape("vua-3-day")[0]).toEqual([3, "g", 3, "g", 3]);
    expect(shape("hang-dau-nho")).toEqual([[2, 2, 2, 2], [3, 3, 3, 3], [3, 3, 3, 3], [3, 3, 3, 3]]);
    expect(shape("chu-u")).toEqual([[2, "g", "g", 2], [2, "g", "g", 2], [2, "g", "g", 2], [3, 3, 3, 3]]);
    expect(shape("truyen-thong-3-day")[4]).toEqual([3, "g", 4, "g", 3]);
  });

  it("generates unique ids across rows, benches and gaps", () => {
    for (const t of TEMPLATES) {
      const layout = buildTemplateLayout(t.id, () => crypto.randomUUID())!;
      const ids = layout.flatMap((r) => [r.id, ...r.items.map((i) => i.id)]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("builds independent objects each time", () => {
    const a = buildTemplateLayout("vua-3-day", () => crypto.randomUUID())!;
    const b = buildTemplateLayout("vua-3-day", () => crypto.randomUUID())!;
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0].items[0]).not.toBe(b[0].items[0]);
    expect(a[0].id).not.toBe(b[0].id);
    const snapshot = JSON.stringify(b);
    (a[0].items as unknown[]).length = 0;
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  it("returns null for an unknown template id", () => {
    expect(buildTemplateLayout("khong-co", counter())).toBeNull();
    expect(buildTemplateLayout("__proto__", counter())).toBeNull();
    expect(buildTemplateLayout("", counter())).toBeNull();
  });
});

describe("capacityStatus", () => {
  it("reports surplus when seats exceed students", () => {
    expect(capacityStatus(36, 30)).toMatchObject({ fits: true, delta: 6, label: "đủ chỗ, dư 6", badge: "Dư 6 chỗ" });
  });
  it("is exactly enough at the boundary", () => {
    expect(capacityStatus(24, 24)).toMatchObject({ fits: true, delta: 0, label: "đủ chỗ, dư 0", badge: "Vừa đủ chỗ" });
  });
  it("reports shortage by one seat", () => {
    expect(capacityStatus(24, 25)).toMatchObject({ fits: false, delta: 1, label: "thiếu 1 chỗ", badge: "Thiếu 1 chỗ" });
  });
  it("handles an empty class", () => {
    expect(capacityStatus(24, 0)).toMatchObject({ fits: true, delta: 24 });
  });
});
