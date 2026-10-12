import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { describeAuditEvent } from "@/lib/audit/describe";
import { AuditLogList, type LogLine } from "./AuditLogList";

const render = (items: LogLine[]) => renderToStaticMarkup(createElement(AuditLogList, { items }));
const line = (over: Partial<LogLine>): LogLine => ({
  id: crypto.randomUUID(), source: "audit", at: new Date("2026-10-12T05:00:00Z"), day: "2026-10-12", actor: "An", what: "thêm em Bình", entity: "student", ...over,
});

describe("AuditLogList", () => {
  it("groups lines by VN day with a day heading and shows the VN time", () => {
    const html = render([
      line({ at: new Date("2026-10-12T05:00:00Z"), what: "thêm em A" }),
      line({ at: new Date("2026-10-12T01:30:00Z"), what: "thêm em B" }),
      line({ at: new Date("2026-10-11T17:30:00Z"), day: "2026-10-12", what: "thêm em C" }),
      line({ at: new Date("2026-10-11T03:00:00Z"), day: "2026-10-11", what: "thêm em D" }),
    ]);
    expect(html.match(/<h3/g)).toHaveLength(2);
    expect(html).toContain("Thứ hai, 12/10/2026");
    expect(html).toContain("Chủ nhật, 11/10/2026");
    expect(html).toContain(">12:00<"); // 05:00Z = 12:00 giờ VN
    expect(html).toContain(">00:30<");
    expect(html.indexOf("thêm em A")).toBeLessThan(html.indexOf("thêm em D"));
  });

  it("prints a masked phone as masked and escapes markup in names and reasons", () => {
    const d = describeAuditEvent({
      action: "student.contact_update", actorName: "<img src=x onerror=alert(1)>",
      summary: { studentName: "An <b>", changed: ["parentPhone"], before: { parentPhone: null }, after: { parentPhone: "••••••567" } },
    });
    const html = render([line({ actor: d.actor, what: d.what })]);
    expect(html).toContain("••••••567");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders a legacy unmasked phone or card token masked, never raw JSON", () => {
    const d = describeAuditEvent({
      action: "attendance.set", actorName: "An",
      summary: { studentName: "Bình", sessionDate: "2026-10-12", sessionKind: "class", before: null, after: { status: "late", reason: "mẹ 0901234567" }, qr_token: "zzz", raw: { a: 1 } },
    });
    const html = render([line({ actor: d.actor, what: d.what, entity: "attendance" })]);
    expect(html).not.toMatch(/0901234567|qr_token|zzz|\{&quot;|\{"/);
    expect(html).toContain("••••••567");
  });

  it("renders nothing for an empty list", () => {
    expect(render([])).not.toContain("<li");
  });
});
