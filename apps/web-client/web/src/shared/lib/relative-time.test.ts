import { afterEach, describe, expect, it, vi } from "vitest";
import { relativeTime } from "@/shared/lib/relative-time";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chat relativeTime", () => {
  it("uses the platform time catalog and unit thresholds in both locales", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
    const now = Date.now() / 1_000;

    vi.stubGlobal("navigator", { language: "en-US", languages: ["en-US"] });
    expect(relativeTime(now - 60)).toBe("1 minute ago");
    expect(relativeTime(now - 86_400)).toBe("yesterday");

    vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
    expect(relativeTime(now - 60)).toBe("1 分钟前");
    expect(relativeTime(now + 86_400)).toBe("明天");
  });

  it("does not render malformed timestamps as a fabricated time", () => {
    vi.stubGlobal("navigator", { language: "zh-CN", languages: ["zh-CN"] });
    expect(relativeTime(Number.NaN)).toBe("时间不可用");
    expect(relativeTime(Number.POSITIVE_INFINITY)).toBe("时间不可用");
  });
});
