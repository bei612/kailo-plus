// DD-119(3,6), REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503
// features/channels/lib/ephemeralChannel.ts and EphemeralChannelBadge over the admitted channel view.
import { act } from "react";
import { beforeEach, expect, it } from "vitest";
import { setLocale } from "../src/i18n";
import { ChannelEphemeralBadge, getEphemeralChannelDisplay, isEphemeralChannel } from "../src/react/ephemeral-channel";
import { render } from "./render";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setLocale("en");
});

const now = Date.parse("2026-10-18T10:00:00Z");

it("keeps ongoing channels unbadged", () => {
  expect(isEphemeralChannel({ ttlSeconds: null, ttlDeadline: null })).toBe(false);
  expect(isEphemeralChannel({})).toBe(false);
  expect(getEphemeralChannelDisplay({}, "en", now)).toBeNull();
});

it("uses the original inactivity wording when only the TTL is known", () => {
  expect(getEphemeralChannelDisplay({ ttlSeconds: 3_600 }, "en", now)).toEqual({
    detailLabel: "1h TTL", tooltipLabel: "Ephemeral channel. Cleans up after 1 hour of inactivity.",
  });
  expect(getEphemeralChannelDisplay({ ttlSeconds: 7 * 86_400 }, "en", now)?.tooltipLabel)
    .toBe("Ephemeral channel. Cleans up after 7 days of inactivity.");
  expect(getEphemeralChannelDisplay({ ttlSeconds: 1_800 }, "zh-CN", now)?.tooltipLabel)
    .toBe("临时频道。不活跃 30 分钟 后清理。");
});

it("counts down to the Relay deadline and reports a due cleanup", () => {
  const soon = getEphemeralChannelDisplay({ ttlSeconds: 3_600, ttlDeadline: "2026-10-18T10:05:00Z" }, "en", now)!;
  expect(soon.detailLabel).toBe("5m left");
  expect(soon.tooltipLabel).toMatch(/^Ephemeral channel\. Cleans up in 5 minutes\. Scheduled for /);
  const later = getEphemeralChannelDisplay({ ttlDeadline: new Date("2026-10-20T10:00:00Z") }, "en", now)!;
  expect(later.detailLabel).toBe("2d left");
  expect(getEphemeralChannelDisplay({ ttlDeadline: "2026-10-18T09:00:00Z" }, "en", now)).toEqual({
    detailLabel: "Cleanup due", tooltipLabel: "Ephemeral channel. Cleanup is due now.",
  });
  expect(getEphemeralChannelDisplay({ ttlDeadline: "2026-10-18T09:00:00Z" }, "zh-CN", now)?.tooltipLabel)
    .toBe("临时频道。现已到清理时间。");
});

it("renders the original ClockFading badge with a reactive accessible label", async () => {
  const host = await render(<ChannelEphemeralBadge channel={{ id: "w", ttlSeconds: 86_400 }} testId="chat-ephemeral-badge" variant="header" />);
  const badge = host.querySelector("[data-testid=chat-ephemeral-badge]")!;
  expect(badge.getAttribute("role")).toBe("img");
  expect(badge.getAttribute("aria-label")).toBe("Ephemeral channel. Cleans up after 1 day of inactivity.");
  await act(async () => setLocale("zh-CN"));
  expect(host.querySelector("[data-testid=chat-ephemeral-badge]")?.getAttribute("aria-label")).toBe("临时频道。不活跃 1 天 后清理。");
  const ongoing = await render(<ChannelEphemeralBadge channel={{ id: "o", ttlSeconds: null }} testId="ongoing" variant="sidebar" />);
  expect(ongoing.querySelector("[data-testid=ongoing]")).toBeNull();
});
