import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/format";

const now = Date.parse("2026-09-25T14:00:00Z");

function at(secondsFromNow: number): string {
  return new Date(now + secondsFromNow * 1_000).toISOString();
}

describe("shared platform relative time", () => {
  it("uses the same bounded units and plural forms for past and future", () => {
    expect(relativeTime("en", at(0), now)).toBe("now");
    expect(relativeTime("en", at(-1), now)).toBe("1 second ago");
    expect(relativeTime("en", at(-59), now)).toBe("59 seconds ago");
    expect(relativeTime("en", at(-60), now)).toBe("1 minute ago");
    expect(relativeTime("en", at(120), now)).toBe("in 2 minutes");
    expect(relativeTime("en", at(-3600), now)).toBe("1 hour ago");
    expect(relativeTime("en", at(-86400), now)).toBe("yesterday");
    expect(relativeTime("en", at(86400), now)).toBe("tomorrow");
    expect(relativeTime("en", at(-2592000), now)).toBe("last month");
  });

  it("renders Chinese without English plural suffixes and does not invert future time", () => {
    expect(relativeTime("zh-CN", at(-60), now)).toBe("1 分钟前");
    expect(relativeTime("zh-CN", at(120), now)).toBe("2 分钟后");
    expect(relativeTime("zh-CN", at(86400), now)).toBe("明天");
    expect(relativeTime("zh-CN", at(-2592000), now)).toBe("上个月");
  });

  it("renders an invalid timestamp as an explicit unavailable state", () => {
    expect(relativeTime("en", "invalid", now)).toBe("Time unavailable");
    expect(relativeTime("zh-CN", "invalid", now)).toBe("时间不可用");
  });
});
