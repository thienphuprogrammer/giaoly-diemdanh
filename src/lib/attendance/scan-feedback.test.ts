import { describe, expect, it } from "vitest";
import { FEEDBACK_OFF, FEEDBACK_ON, parseFeedbackSetting, serializeFeedbackSetting } from "./scan-feedback";

describe("scan feedback setting", () => {
  it("defaults to on when nothing (or something unknown) is stored", () => {
    expect(parseFeedbackSetting(null)).toBe(true);
    expect(parseFeedbackSetting("garbage")).toBe(true);
    expect(parseFeedbackSetting(FEEDBACK_ON)).toBe(true);
  });
  it("is off only when explicitly stored off, and round-trips", () => {
    expect(parseFeedbackSetting(FEEDBACK_OFF)).toBe(false);
    expect(parseFeedbackSetting(serializeFeedbackSetting(false))).toBe(false);
    expect(parseFeedbackSetting(serializeFeedbackSetting(true))).toBe(true);
  });
});
