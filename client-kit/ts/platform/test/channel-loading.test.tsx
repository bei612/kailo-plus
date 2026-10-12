import { describe, expect, it } from "vitest";
import { ChannelLoadingFallback } from "../src/react/messages/ChannelLoadingFallback";
import { channelChrome } from "../src/react/messages/chromeLayout";
import { render } from "./render";

describe("original shared channel loading presentation", () => {
  it("keeps the original message rows and composer without inventing an actionable editor", async () => {
    const ui = await render(<ChannelLoadingFallback />);
    expect(ui.querySelectorAll("article")).toHaveLength(4);
    expect(ui.querySelectorAll("article .t-skel-bar")).toHaveLength(32);
    expect(ui.querySelector(".pb-32")).not.toBeNull();
    const rows = ui.querySelector("article")?.parentElement;
    for (const token of channelChrome.contentPadding.split(" ")) {
      expect(rows?.classList.contains(token)).toBe(true);
    }
    expect(ui.querySelector(".absolute.inset-x-0.bottom-0.z-10 .rounded-2xl")).not.toBeNull();
    expect(ui.querySelector("button, input, textarea, [contenteditable]" )).toBeNull();
    expect(ui.textContent).toBe("");
  });

  it("includes the original in-flow header for the lazy channel and does not reserve its height twice", async () => {
    const ui = await render(<ChannelLoadingFallback includeHeader />);
    expect(ui.querySelectorAll("header")).toHaveLength(1);
    expect(ui.querySelectorAll("header .t-skel-bar")).toHaveLength(4);
    expect(ui.querySelector("[data-tauri-drag-region]")).not.toBeNull();
    const rows = ui.querySelector("article")?.parentElement;
    expect(rows?.classList.contains("pt-3")).toBe(true);
    expect(rows?.className).not.toContain(channelChrome.contentPadding);
  });
});
