import { describe, expect, it } from "vitest";
import { SESSION_MAX_AGE_S, SESSION_REFRESH_BELOW_S, sessionRefreshDecision } from "./session-policy";

const NOW = 1_800_000_000; // giây
const DAY = 24 * 60 * 60;

describe("session policy constants", () => {
  it("30-day session, refreshed when under 3 days remain", () => {
    expect(SESSION_MAX_AGE_S).toBe(30 * DAY);
    expect(SESSION_REFRESH_BELOW_S).toBe(3 * DAY);
  });
});

describe("sessionRefreshDecision", () => {
  it.each([
    ["fresh token (30 days left)", NOW + 30 * DAY, "keep"],
    ["10 days left", NOW + 10 * DAY, "keep"],
    ["exactly 3 days left is not refreshed", NOW + 3 * DAY, "keep"],
    ["one second under 3 days", NOW + 3 * DAY - 1, "refresh"],
    ["1 day left", NOW + DAY, "refresh"],
    ["one second left", NOW + 1, "refresh"],
    ["expires right now", NOW, "invalid"],
    ["expired one second ago", NOW - 1, "invalid"],
    ["expired long ago", NOW - 40 * DAY, "invalid"],
  ] as const)("%s → %s", (_label, exp, expected) => {
    expect(sessionRefreshDecision(exp, NOW)).toBe(expected);
  });

  it.each([
    ["missing exp", undefined],
    ["NaN exp", Number.NaN],
    ["infinite exp", Number.POSITIVE_INFINITY],
    ["exp far beyond the maximum lifetime", NOW + SESSION_MAX_AGE_S + DAY],
  ])("%s → invalid (never extended)", (_label, exp) => {
    expect(sessionRefreshDecision(exp, NOW)).toBe("invalid");
  });

  it("tolerates a little clock skew above the maximum lifetime", () => {
    expect(sessionRefreshDecision(NOW + SESSION_MAX_AGE_S + 60, NOW)).toBe("keep");
  });
});
