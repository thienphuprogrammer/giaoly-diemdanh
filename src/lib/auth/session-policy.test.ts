import { describe, expect, it } from "vitest";
import {
  LEGACY_SESSION_MAX_AGE_S, SESSION_ABSOLUTE_MAX_S, SESSION_MAX_AGE_S, SESSION_REFRESH_BELOW_S, passwordChangeSecond, sessionAuthTime, sessionRefreshDecision,
  sessionRevokedByPasswordChange,
} from "./session-policy";

const NOW = 1_800_000_000; // giây
const DAY = 24 * 60 * 60;
const LOGIN = NOW - DAY; // token thật luôn mang `sat` (lúc đăng nhập)

describe("session policy constants", () => {
  it("180-day sliding session, refreshed when under 30 days remain, one-year cap from login", () => {
    expect(SESSION_MAX_AGE_S).toBe(180 * DAY);
    expect(SESSION_REFRESH_BELOW_S).toBe(30 * DAY);
    expect(SESSION_ABSOLUTE_MAX_S).toBe(365 * DAY);
  });

  it("keeps the pre-change 30-day lifetime for deriving sat of legacy tokens", () => {
    expect(LEGACY_SESSION_MAX_AGE_S).toBe(30 * DAY);
  });
});

describe("sessionRefreshDecision", () => {
  it.each([
    ["fresh token (180 days left)", NOW + 180 * DAY, "keep"],
    ["100 days left", NOW + 100 * DAY, "keep"],
    ["exactly 30 days left is not refreshed", NOW + 30 * DAY, "keep"],
    ["one second under 30 days", NOW + 30 * DAY - 1, "refresh"],
    ["10 days left", NOW + 10 * DAY, "refresh"],
    ["1 day left", NOW + DAY, "refresh"],
    ["one second left", NOW + 1, "refresh"],
    ["expires right now", NOW, "invalid"],
    ["expired one second ago", NOW - 1, "invalid"],
    ["expired long ago", NOW - 40 * DAY, "invalid"],
  ] as const)("%s → %s", (_label, exp, expected) => {
    expect(sessionRefreshDecision(exp, NOW, LOGIN)).toBe(expected);
  });

  it.each([
    ["missing exp", undefined],
    ["NaN exp", Number.NaN],
    ["infinite exp", Number.POSITIVE_INFINITY],
    ["exp far beyond the maximum lifetime", NOW + SESSION_MAX_AGE_S + DAY],
  ])("%s → invalid (never extended)", (_label, exp) => {
    expect(sessionRefreshDecision(exp, NOW, LOGIN)).toBe("invalid");
  });

  it("tolerates a little clock skew above the maximum lifetime", () => {
    expect(sessionRefreshDecision(NOW + SESSION_MAX_AGE_S + 60, NOW, LOGIN)).toBe("keep");
  });
});

describe("absolute one-year cap (sat = session-auth time)", () => {
  const CAP = SESSION_ABSOLUTE_MAX_S;
  const nearExpiry = NOW + DAY; // would normally be refreshed

  it.each([
    ["logged in today", NOW, "refresh"],
    ["logged in 300 days ago", NOW - 300 * DAY, "refresh"],
    ["exactly at the cap still refreshes", NOW - CAP, "refresh"],
    ["cap + 1s ago: no refresh, ends at natural exp", NOW - CAP - 1, "keep"],
    ["cap + 4 min ago (inside skew): keep", NOW - CAP - 4 * 60, "keep"],
    ["cap + 1 hour ago: refused", NOW - CAP - 3600, "invalid"],
    ["400 days ago: refused", NOW - 400 * DAY, "invalid"],
    ["sat in the future beyond skew: refused", NOW + DAY, "invalid"],
  ] as const)("%s → %s", (_label, sat, expected) => {
    expect(sessionRefreshDecision(nearExpiry, NOW, sat)).toBe(expected);
  });

  it("a fresh token past the cap is refused too", () => {
    expect(sessionRefreshDecision(NOW + 100 * DAY, NOW, NOW - CAP - 2 * DAY)).toBe("invalid");
    expect(sessionRefreshDecision(NOW + 100 * DAY, NOW, NOW - 60 * DAY)).toBe("keep");
  });

  it.each([["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY]])("non-finite sat (%s) is refused", (_l, sat) => {
    expect(sessionRefreshDecision(NOW + 100 * DAY, NOW, sat)).toBe("invalid");
  });
});

describe("sessionAuthTime (migration for tokens without sat)", () => {
  it("uses sat when present", () => {
    expect(sessionAuthTime({ exp: NOW + 30 * DAY, sat: NOW - 5 })).toBe(NOW - 5);
  });
  it("treats a missing sat as exp - 30 days", () => {
    expect(sessionAuthTime({ exp: NOW + 7 * DAY })).toBe(NOW + 7 * DAY - LEGACY_SESSION_MAX_AGE_S);
  });
  it("a legacy token without sat near expiry is still refreshed", () => {
    const exp = NOW + DAY;
    expect(sessionRefreshDecision(exp, NOW, sessionAuthTime({ exp }))).toBe("refresh");
  });
});

describe("sessionRevokedByPasswordChange (đổi/đặt lại mật khẩu thu hồi phiên cũ)", () => {
  const changedAt = new Date(NOW * 1000);

  it("keeps every session when the password was never changed (legacy rows: null)", () => {
    expect(sessionRevokedByPasswordChange(NOW - 80 * DAY, null)).toBe(false);
    expect(sessionRevokedByPasswordChange(NOW, null)).toBe(false);
  });

  it("revokes a session logged in before the change", () => {
    expect(sessionRevokedByPasswordChange(NOW - 1, changedAt)).toBe(true);
    expect(sessionRevokedByPasswordChange(NOW - 30 * DAY, changedAt)).toBe(true);
  });

  it("keeps a session logged in at or after the change (same second is kept: the changing device re-issues sat = now)", () => {
    expect(sessionRevokedByPasswordChange(NOW, changedAt)).toBe(false);
    expect(sessionRevokedByPasswordChange(NOW + 1, changedAt)).toBe(false);
  });

  it("compares at second granularity: sub-second parts of the stored timestamp are truncated", () => {
    const withMs = new Date(NOW * 1000 + 999);
    expect(sessionRevokedByPasswordChange(NOW, withMs)).toBe(false);
    expect(sessionRevokedByPasswordChange(NOW - 1, withMs)).toBe(true);
  });

  it("passwordChangeSecond truncates to whole seconds", () => {
    expect(passwordChangeSecond(new Date(NOW * 1000 + 999))).toEqual(new Date(NOW * 1000));
    expect(passwordChangeSecond(new Date(NOW * 1000))).toEqual(new Date(NOW * 1000));
  });
});
