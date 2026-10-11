import { describe, expect, it } from "vitest";
import { guardedNavigation, type LinkClick } from "./leave-guard";

const HERE = "https://app.test/lop/1/diem-danh/2026-10-11";
const click = (over: Partial<LinkClick> = {}): LinkClick => ({
  href: "https://app.test/lop/1", target: "", download: false, button: 0, modifier: false, defaultPrevented: false, ...over,
});

describe("guardedNavigation", () => {
  it("returns the in-app path (with query) for a plain left click on a same-origin link", () => {
    expect(guardedNavigation(click({ href: "https://app.test/lop/1?tab=a" }), HERE)).toBe("/lop/1?tab=a");
  });

  it("ignores new-tab, download, modified, non-left and already-handled clicks", () => {
    expect(guardedNavigation(click({ target: "_blank" }), HERE)).toBeNull();
    expect(guardedNavigation(click({ download: true }), HERE)).toBeNull();
    expect(guardedNavigation(click({ modifier: true }), HERE)).toBeNull();
    expect(guardedNavigation(click({ button: 1 }), HERE)).toBeNull();
    expect(guardedNavigation(click({ defaultPrevented: true }), HERE)).toBeNull();
  });

  it("ignores other origins, non-http schemes and same-page hash links", () => {
    expect(guardedNavigation(click({ href: "https://other.test/x" }), HERE)).toBeNull();
    expect(guardedNavigation(click({ href: "mailto:a@b.c" }), HERE)).toBeNull();
    expect(guardedNavigation(click({ href: `${HERE}#top` }), HERE)).toBeNull();
  });

  it("treats target=_self as a normal link", () => {
    expect(guardedNavigation(click({ target: "_self" }), HERE)).toBe("/lop/1");
  });
});
