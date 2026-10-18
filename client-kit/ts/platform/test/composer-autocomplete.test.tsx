// REQ-24: Buzz 779af8886caae1317b4de962082429867ab61503 MessageComposer `#channel` and `:shortcode`
// autocompletes, now shared by the Web and Desktop composers.
import { act } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { selectChannelSuggestions, useChannelLinks, type ChannelLinkSource } from "../src/react/composer/features/messages/lib/useChannelLinks";
import { useEmojiAutocomplete } from "../src/react/composer/features/messages/lib/useEmojiAutocomplete";
import { ChannelAutocomplete } from "../src/react/composer/features/messages/ui/ChannelAutocomplete";
import { render } from "./render";

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });

const channels: ChannelLinkSource[] = [
  { id: "c1", name: "general", channelType: "stream", archivedAt: null },
  { id: "c2", name: "general-archive", channelType: "stream", archived: true },
  { id: "c3", name: "general-old", channelType: "forum", archivedAt: "2026-10-01T00:00:00Z" },
  { id: "c4", name: "general-dm", channelType: "dm" },
  { id: "c5", name: "general-forum", channelType: "forum" },
];

it("suggests only live stream/forum channels, matching the original selection", () => {
  expect(selectChannelSuggestions(channels, "GEN").map((suggestion) => suggestion.id)).toEqual(["c1", "c5"]);
  expect(selectChannelSuggestions(channels, "forum")).toEqual([{ id: "c5", name: "general-forum", channelType: "forum" }]);
});

it("opens after the original debounce and inserts the original `#name ` edit", async () => {
  let links!: ReturnType<typeof useChannelLinks>;
  function Probe() { links = useChannelLinks(channels); return null; }
  await render(<Probe />);
  expect(links.knownChannelNames).toEqual(["general", "general-forum"]);
  await act(async () => { links.updateChannelQuery("hi #gen", 7); await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(links.isChannelOpen).toBe(true);
  expect(links.channelSuggestions.map((suggestion) => suggestion.name)).toEqual(["general", "general-forum"]);
  let edit!: ReturnType<typeof links.insertChannel>;
  await act(async () => { edit = links.insertChannel(links.channelSuggestions[0]!, 7); });
  expect(edit).toEqual({ replaceFromOffset: 3, replaceToOffset: 7, insertText: "#general " });
  expect(links.isChannelOpen).toBe(false);
});

it("inserts the selected standard emoji over the original `:shortcode` query", async () => {
  let emoji!: ReturnType<typeof useEmojiAutocomplete>;
  function Probe() { emoji = useEmojiAutocomplete(); return null; }
  await render(<Probe />);
  await act(async () => { emoji.updateEmojiQuery("hi :smi", 7); await new Promise((resolve) => setTimeout(resolve, 200)); });
  let edit!: ReturnType<typeof emoji.insertEmoji>;
  await act(async () => { edit = emoji.insertEmoji({ id: "smile", name: "Smiling Face", native: "😄" }, 7); });
  expect(edit).toEqual({ replaceFromOffset: 3, replaceToOffset: 7, insertText: "😄 " });
  // A single `:x` is too short for the original query.
  await act(async () => { emoji.updateEmojiQuery(":x", 2); await new Promise((resolve) => setTimeout(resolve, 200)); });
  expect(emoji.isEmojiAutocompleteOpen).toBe(false);
});

it("renders the original channel overlay only for the focused composer", async () => {
  const select = vi.fn();
  const suggestion = { id: "c1", name: "general", channelType: "stream" as const };
  const hidden = await render(<ChannelAutocomplete suggestions={[suggestion]} selectedIndex={0} composerOwnsFocus={false} onSelect={select} />);
  expect(hidden.querySelector("button")).toBeNull();
  const host = await render(<ChannelAutocomplete suggestions={[suggestion]} selectedIndex={0} composerOwnsFocus onSelect={select} />);
  const option = host.querySelector("button")!;
  expect(option.textContent).toContain("#general");
  await act(async () => { option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
  expect(select).toHaveBeenCalledWith(suggestion);
});
