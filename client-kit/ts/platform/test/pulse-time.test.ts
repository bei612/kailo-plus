// @vitest-environment node
import { describe, expect, it } from "vitest";
import { translate, type PlatformMessageKey } from "../src/i18n";
import { formatPulseRelativeTime } from "../src/react/pulse/lib/formatRelativeTime";

// Buzz 779af8886caae1317b4de962082429867ab61503 NoteCard/AgentActivityCard formatRelativeTime thresholds.
describe("original Pulse compact relative time", () => {
  const now = 1_790_000_000;
  const en = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("en", key, variables);
  const zh = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("zh-CN", key, variables);
  it("keeps the note card's compact units and the agent card's ago suffix", () => {
    expect(formatPulseRelativeTime(now - 30, en, "en", {}, now)).toBe("just now");
    expect(formatPulseRelativeTime(now - 5 * 60, en, "en", {}, now)).toBe("5m");
    expect(formatPulseRelativeTime(now - 3 * 3_600, en, "en", {}, now)).toBe("3h");
    expect(formatPulseRelativeTime(now - 2 * 86_400, en, "en", {}, now)).toBe("2d");
    expect(formatPulseRelativeTime(now - 5 * 60, en, "en", { ago: true }, now)).toBe("5m ago");
    expect(formatPulseRelativeTime(now - 3 * 3_600, zh, "zh-CN", { ago: true }, now)).toBe("3 小时前");
    expect(formatPulseRelativeTime(now - 10 * 86_400, en, "en", {}, now))
      .toBe(new Date((now - 10 * 86_400) * 1_000).toLocaleDateString("en", { month: "short", day: "numeric" }));
  });
});
