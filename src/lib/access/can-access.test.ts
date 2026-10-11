import { describe, expect, it } from "vitest";
import { canAccess, canManageGrade, type AccessClass } from "./can-access";

const cls: AccessClass = { id: "c1", gradeId: "g1", catechistIds: ["glv"] };
const glv = { id: "glv", isGradeHead: false, gradeId: "g1" };
const stranger = { id: "x", isGradeHead: false, gradeId: "g1" };
const head = { id: "head", isGradeHead: true, gradeId: "g1" };
const otherHead = { id: "h2", isGradeHead: true, gradeId: "g2" };

describe("canAccess", () => {
  it("lets an assigned catechist read and write", () => {
    expect(canAccess(glv, cls, "read")).toBe(true);
    expect(canAccess(glv, cls, "write")).toBe(true);
  });

  it("denies an unassigned catechist", () => {
    expect(canAccess(stranger, cls, "read")).toBe(false);
    expect(canAccess(stranger, cls, "write")).toBe(false);
  });

  it("lets the grade head read but not write classes in the grade", () => {
    expect(canAccess(head, cls, "read")).toBe(true);
    expect(canAccess(head, cls, "write")).toBe(false);
  });

  it("lets the grade head write after assigning themselves", () => {
    expect(canAccess(head, { ...cls, catechistIds: ["glv", "head"] }, "write")).toBe(true);
  });

  it("denies a head of another grade", () => {
    expect(canAccess(otherHead, cls, "read")).toBe(false);
  });

  it("denies a catechist who was removed from the class", () => {
    expect(canAccess(glv, { ...cls, catechistIds: [] }, "read")).toBe(false);
  });
});

describe("canManageGrade", () => {
  it("only the head of that grade", () => {
    expect(canManageGrade(head, "g1")).toBe(true);
    expect(canManageGrade(head, "g2")).toBe(false);
    expect(canManageGrade(glv, "g1")).toBe(false);
  });
});
