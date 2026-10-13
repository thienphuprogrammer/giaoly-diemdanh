import { describe, expect, it } from "vitest";
import { canAccess, canManageGrade, type AccessClass } from "./can-access";

const cls: AccessClass = { id: "c1", gradeId: "g1", schoolYearId: "y1", catechistIds: ["glv"] };
const glv = { id: "glv", isAdmin: false, isGradeHead: false, gradeId: "g1" };
const stranger = { id: "x", isAdmin: false, isGradeHead: false, gradeId: "g1" };
const head = { id: "head", isAdmin: false, isGradeHead: true, gradeId: "g1" };
const otherHead = { id: "h2", isAdmin: false, isGradeHead: true, gradeId: "g2" };
const admin = { id: "admin", isAdmin: true, isGradeHead: false, gradeId: null };

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

  it("lets an admin read and write classes in any grade and year without an assignment", () => {
    const otherYearClass = { ...cls, gradeId: "g2", schoolYearId: "y2", catechistIds: [] };
    expect(canAccess(admin, cls, "read")).toBe(true);
    expect(canAccess(admin, cls, "write")).toBe(true);
    expect(canAccess(admin, otherYearClass, "read")).toBe(true);
    expect(canAccess(admin, otherYearClass, "write")).toBe(true);
  });

  it("does not retain global access after the admin role is removed", () => {
    const formerAdmin = { ...admin, isAdmin: false };
    expect(canAccess(formerAdmin, cls, "read")).toBe(false);
    expect(canAccess(formerAdmin, cls, "write")).toBe(false);
  });
});

describe("canManageGrade", () => {
  it("only the head of that grade", () => {
    expect(canManageGrade(head, "g1")).toBe(true);
    expect(canManageGrade(head, "g2")).toBe(false);
    expect(canManageGrade(glv, "g1")).toBe(false);
  });

  it("lets an admin manage every grade without a grade-head role", () => {
    expect(canManageGrade(admin, "g1")).toBe(true);
    expect(canManageGrade(admin, "g2")).toBe(true);
    expect(canManageGrade({ ...admin, isAdmin: false }, "g1")).toBe(false);
  });
});
