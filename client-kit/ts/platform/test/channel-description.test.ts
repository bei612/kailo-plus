// REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503 features/channels/lib/channelDescription.ts.
import { expect, it } from "vitest";
import { getChannelDescription, getChannelDetail } from "../src/react/channel-description";

it("prefers topic, then description, then purpose, without duplicating overlapping fields", () => {
  expect(getChannelDetail({ topic: "  Topic  ", description: "About", purpose: "Why" })).toBe("Topic");
  expect(getChannelDetail({ topic: " ", description: "About", purpose: "Why" })).toBe("About");
  expect(getChannelDetail({ purpose: "Why" })).toBe("Why");
  expect(getChannelDetail({})).toBeNull();
});

it("prefixes archived channels and falls back to the original placeholder", () => {
  expect(getChannelDescription({ description: "Line one\nLine two", archived: true }, "en")).toBe("Archived.\nLine one\nLine two");
  expect(getChannelDescription({ archived: false }, "en")).toBe("Channel details and activity.");
  expect(getChannelDescription({ archived: true }, "zh-CN")).toBe("已归档。");
});
