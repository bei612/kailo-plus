// Original Buzz 779af8886caae1317b4de962082429867ab61503 reaction order and quick-reaction cases.
import assert from "node:assert/strict";
import { expect, test, vi } from "vitest";
import { act } from "react";
import { render } from "./render";
import { TransportError } from "../src/transport";
import type { TimelineMessage } from "../src/react/messages/types";
import { MessageReactions } from "../src/react/messages/reactions/MessageReactions";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { buildMessageReactions } from "../src/react/messages/reactions/buildMessageReactions";
import { MessageRowSurface } from "../src/react/messages/MessageRowSurface";
import { MessageActionBarSurface } from "../src/react/messages/MessageActionBarSurface";
import type { RelayEvent } from "../src/react/forum/channelWindowResponse";
import { reactionThreadInteractionRoots, threadReactionRoot } from "../src/react/messages/reactions/threadReactionInteraction";

import {
  applyOptimisticReaction,
  selectDisplayReactions,
  useReactionHandler,
} from "../src/react/messages/reactions/useReactionHandler";

// ---------------------------------------------------------------------------
// applyOptimisticReaction — order-preservation invariant
//
// The hook's reactions memo is `optimisticReactions ?? sourceReactions ?? []`
// with no re-sort. These tests verify that applyOptimisticReaction itself
// never reorders pills so the formatter's chronological order is preserved
// through optimistic updates.
// ---------------------------------------------------------------------------

function pill(emoji: string, count: number, reactedByCurrentUser = false) {
  return {
    emoji,
    count,
    reactedByCurrentUser,
    users: reactedByCurrentUser
      ? [{ pubkey: "aaa", displayName: "You", avatarUrl: null }]
      : [{ pubkey: "bbb", displayName: "Alice", avatarUrl: null }],
  };
}

test("confirmed reaction interest uses the original root-or-message identity and admitted target closure", () => {
  const me = "b".repeat(64), rootId = "a".repeat(64), replyId = "c".repeat(64);
  const root: RelayEvent = { id: rootId, pubkey: "d".repeat(64), kind: 9, content: "root", created_at: 1, tags: [["h", "channel"]] };
  const reply: RelayEvent = { ...root, id: replyId, created_at: 2, tags: [...root.tags, ["e", root.id, "", "root"], ["e", root.id, "", "reply"]] };
  const reaction: RelayEvent = { ...root, id: "e".repeat(64), pubkey: me, kind: 7, created_at: 3, content: "👍", tags: [["e", rootId], ["e", replyId]] };
  expect(threadReactionRoot({ id: replyId, rootId })).toBe(rootId);
  expect(threadReactionRoot({ id: rootId })).toBe(rootId);
  expect(threadReactionRoot({ id: "", rootId: "" })).toBeNull();
  expect([...reactionThreadInteractionRoots([reaction, reply, root], new Set([me]), "channel")]).toEqual([rootId]);
  expect([...reactionThreadInteractionRoots([root, reply, reaction], new Set([me]), "channel")]).toEqual([rootId]);
  const deletion: RelayEvent = { ...reaction, id: "f".repeat(64), kind: 5, tags: [["e", reaction.id]] };
  // Original removal never undoes a confirmed historical interaction.
  expect([...reactionThreadInteractionRoots([root, reply, reaction, deletion], new Set([me]), "channel")]).toEqual([rootId]);
  expect([...reactionThreadInteractionRoots([root, reply, deletion], new Set([me]), "channel")]).toEqual([]);
  expect([...reactionThreadInteractionRoots([root, reply, reaction], new Set(), "channel")]).toEqual([]);
  expect([...reactionThreadInteractionRoots([root, reply, { ...reaction, pubkey: root.pubkey, tags: [...reaction.tags, ["actor", me]] }], new Set([me]), "channel")]).toEqual([]);
  for (const events of [
    [root, reaction], // The actual last e-tag target is absent.
    [reply, reaction], // Reply exists but its root is not admitted.
    [root, reply, { ...reaction, tags: [...reaction.tags, ["h", "other"]] }],
    [root, reply, { ...reaction, tags: [...reaction.tags, ["h", "channel"], ["h", "other"]] }],
    [root, { ...reply, tags: [["h", "other"], ...reply.tags.slice(1)] }, reaction],
    [root, reply, reaction, { ...deletion, tags: [["e", root.id]] }],
    [root, reply, reaction, { ...deletion, kind: 9005, tags: [["h", "channel"], ["e", reply.id]] }],
  ]) expect([...reactionThreadInteractionRoots(events, new Set([me]), "channel")]).toEqual([]);
});

test("original formatter groups actors, ignores deleted events and preserves chronological pills", () => {
  const target = "a".repeat(64), me = "b".repeat(64), other = "c".repeat(64);
  const event = (id: string, pubkey: string, content: string, created_at: number): RelayEvent =>
    ({id:id.repeat(64),pubkey,content,created_at,kind:7,tags:[["e",target]]});
  const first = event("d",me,"🎉",10), duplicate = event("e",me,"🎉",20);
  const latest = event("f",other,"👍",30), removed = event("1",other,"❤️",5);
  const deletion: RelayEvent = {...event("2",other,"",40),kind:5,tags:[["e",removed.id]]};
  const events = [latest,duplicate,deletion,removed,first];
  const result = buildMessageReactions(events,me).get(target);
  expect(result?.map(reaction => [reaction.emoji,reaction.count,reaction.reactedByCurrentUser])).toEqual([
    ["🎉",1,true],["👍",1,false],
  ]);
  expect(buildMessageReactions([...events].reverse(),me).get(target)).toEqual(result);
  expect(buildMessageReactions([...events,{...deletion,tags:[["e",target]]}],me).has(target)).toBe(false);
});

test("reaction actor tags cannot impersonate the current signer and custom URL matches its shortcode", () => {
  const target = "a".repeat(64), me = "b".repeat(64), other = "c".repeat(64);
  const event: RelayEvent = {id:"d".repeat(64),pubkey:other,created_at:1,kind:7,content:":shipit:",
    tags:[["e","invalid"],["e",target],["actor",me],["emoji","wrong","https://invalid.test"],["emoji","shipit","https://relay.test/shipit.png"]]};
  const reaction = buildMessageReactions([event],me).get(target)?.[0];
  expect(reaction?.reactedByCurrentUser).toBe(false);
  expect(reaction?.users[0]?.pubkey).toBe(other);
  expect(reaction?.emojiUrl).toBe("https://relay.test/shipit.png");
});

test("actual shared message row exposes original quick reactions and routes toggles to its host", async () => {
  const publish = vi.fn().mockResolvedValue(undefined);
  const message: TimelineMessage = {id:"row",createdAt:1,author:"Alice",time:"",body:"hello",depth:0,reactions:[pill("👍",1)]};
  const host = await render(<TooltipProvider><MessageRowSurface message={message}
    onToggleReaction={publish} reactionScope="row-host" renderBody={() => <p>hello</p>}
    renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} message={message} {...reactions} onCopyMessage={() => {}} />}
  /></TooltipProvider>);
  expect(host.querySelector('[data-testid="react-message-row"]')).not.toBeNull();
  const quick = host.querySelector<HTMLButtonElement>('button[title=":+1:"]') ??
    [...host.querySelectorAll<HTMLButtonElement>('button[title]')].find(button => button.textContent === "👍");
  expect(quick).toBeDefined();
  await act(async () => quick?.click());
  expect(publish).toHaveBeenCalledWith(message,"👍",false);
  expect(host.querySelector('[data-testid="message-action-divider"]')).not.toBeNull();
});

test("actual row keeps UNKNOWN neutral and cannot submit again through a different quick reaction", async () => {
  const publish = vi.fn().mockRejectedValue(new TransportError("uncertain"));
  const message: TimelineMessage = {id:"unknown-row",createdAt:1,author:"Alice",time:"",body:"hello",depth:0};
  const host = await render(<TooltipProvider><MessageRowSurface message={message} onToggleReaction={publish}
    renderBody={() => <p>hello</p>}
    renderActions={(ref,reactions) => <MessageActionBarSurface ref={ref} message={message} {...reactions} onCopyMessage={() => {}} />}
  /></TooltipProvider>);
  const quick = host.querySelector<HTMLButtonElement>('button[title]');
  await act(async () => quick?.click());
  expect(publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="react-message-unknown-row"]')).toBeNull();
  expect(host.querySelector('[role="status"]')).not.toBeNull();
});

test("applyOptimisticReaction: adding new emoji appends to end, preserving prior order", () => {
  // Formatter emits [🎉 (count=3), 👍 (count=1)] — chronological, not count-ranked.
  const source = [pill("🎉", 3), pill("👍", 1)];
  const result = applyOptimisticReaction(source, "❤️", false);
  assert.deepEqual(
    result.map((r) => r.emoji),
    ["🎉", "👍", "❤️"],
    "new reaction must append to end, not reorder by count",
  );
});

test("applyOptimisticReaction: incrementing an existing emoji preserves position", () => {
  // A later emoji (👍) has a lower count than an earlier one (🎉).
  // Incrementing 👍 must NOT move it left of 🎉.
  const source = [pill("🎉", 3), pill("👍", 1)];
  const result = applyOptimisticReaction(source, "👍", false);
  assert.deepEqual(
    result.map((r) => r.emoji),
    ["🎉", "👍"],
    "incrementing count on a later emoji must not change its position",
  );
  assert.equal(result[1]!.count, 2);
});

test("applyOptimisticReaction: removing last reactor removes pill, preserving remaining order", () => {
  const source = [pill("🎉", 2), pill("👍", 1, true), pill("❤️", 1)];
  const result = applyOptimisticReaction(source, "👍", true);
  assert.deepEqual(
    result.map((r) => r.emoji),
    ["🎉", "❤️"],
    "removing a pill must not reorder the remaining pills",
  );
});

test("applyOptimisticReaction: removing one of several reactors decrements count, preserves position", () => {
  const source = [pill("🎉", 1), pill("👍", 2, true)];
  const result = applyOptimisticReaction(source, "👍", true);
  assert.deepEqual(
    result.map((r) => r.emoji),
    ["🎉", "👍"],
  );
  assert.equal(result[1]!.count, 1);
});

test("applyOptimisticReaction: no-op when removing an emoji the user has not reacted with", () => {
  const source = [pill("🎉", 1), pill("👍", 1)];
  const result = applyOptimisticReaction(source, "👍", true);
  assert.equal(
    result,
    source,
    "must return same reference when nothing changes",
  );
});

test("applyOptimisticReaction: no-op when adding an emoji the user already reacted with", () => {
  const source = [pill("🎉", 1, true)];
  const result = applyOptimisticReaction(source, "🎉", false);
  assert.equal(
    result,
    source,
    "must return same reference when already reacted",
  );
});

// ---------------------------------------------------------------------------
// selectDisplayReactions — display-path order guard
//
// This is the path that was broken in round 1: reactions were re-sorted by
// count in the memo AFTER applyOptimisticReaction ran. These tests pin the
// invariant: chronological (formatter) order must be preserved, count must
// never influence display position. A test MUST fail if sortReactions or any
// count-based sort is reintroduced in the display selection path.
// ---------------------------------------------------------------------------

test("selectDisplayReactions: returns sourceReactions as-is when no optimistic state (count must not influence order)", () => {
  // Formatter emits 🎉 (count=1) first, then 👍 (count=3) — chronological.
  // If count-sort were reintroduced, this would flip to [👍, 🎉].
  const source = [pill("🎉", 1), pill("👍", 3)];
  const result = selectDisplayReactions(null, source);
  assert.deepEqual(
    result.map((r) => r.emoji),
    ["🎉", "👍"],
    "lower-count earlier emoji must stay left of higher-count later emoji",
  );
  assert.equal(result, source, "must return same reference (no copy/sort)");
});

test("selectDisplayReactions: returns optimisticReactions when present (not sourceReactions)", () => {
  const source = [pill("🎉", 1), pill("👍", 3)];
  const optimistic = [pill("🎉", 1), pill("👍", 3), pill("❤️", 1, true)];
  const result = selectDisplayReactions(optimistic, source);
  assert.equal(result, optimistic, "must return optimistic array when present");
});

test("selectDisplayReactions: returns empty array when both inputs are absent", () => {
  const result = selectDisplayReactions(null, undefined);
  assert.deepEqual(result, []);
});


import { recordQuickReactionEmoji, resolveQuickReactionEmojis, useQuickReactionEmojis } from "../src/react/messages/reactions/useQuickReactionEmojis";

function entry(emoji: string) {
  return { emoji };
}

test("quick reactions backfill defaults after stale custom emoji", () => {
  assert.deepEqual(
    resolveQuickReactionEmojis(
      [
        entry(":gone_one:"),
        entry(":gone_two:"),
        entry(":gone_three:"),
        entry(":gone_four:"),
      ],
      4,
      [],
    ),
    ["👍", "❤️", "😂", "🎉"],
  );
});

test("quick reactions skip stale custom emoji before applying the limit", () => {
  assert.deepEqual(
    resolveQuickReactionEmojis(
      [
        entry(":gone_one:"),
        entry(":gone_two:"),
        entry(":gone_three:"),
        entry(":gone_four:"),
        entry(":shipit:"),
        entry("🔥"),
      ],
      4,
      [{ shortcode: "shipit", url: "https://relay/shipit.png" }],
    ),
    [":shipit:", "🔥", "👍", "❤️"],
  );
});

test("original reaction pills remain read-only without a governed publisher and do not fetch raw media", async () => {
  const onSelect = vi.fn();
  const reaction = { ...pill(":shipit:", 3), emojiUrl: "https://relay.example/media/shipit.png" };
  const host = await render(<TooltipProvider><MessageReactions messageId="message" reactions={[reaction]} canToggle={false} pending={false} onSelect={onSelect} /></TooltipProvider>);
  expect(host.textContent).toContain(":shipit:");
  expect(host.querySelector("button")?.disabled).toBe(true);
  expect(host.querySelector('[data-testid="add-reaction-message"]')).toBeNull();
  expect(host.querySelector("img")).toBeNull();
  host.querySelector("button")?.click();
  expect(onSelect).not.toHaveBeenCalled();
});

test("unknown reaction outcome retains the original pending write instead of permitting another toggle", async () => {
  const message: TimelineMessage = { id: "message", createdAt: 1, author: "Alice", time: "", body: "body", depth: 0 };
  const publish = vi.fn().mockRejectedValue(new TransportError("uncertain"));
  let current: ReturnType<typeof useReactionHandler> | undefined;
  function Probe() {
    current = useReactionHandler(message, publish);
    return null;
  }
  await render(<Probe />);
  await act(async () => { await expect(current?.select("👍")).rejects.toThrow("uncertain"); });
  expect(current?.pending).toBe(true);
  expect(current?.reactions).toEqual([]);
  await act(async () => { await current?.select("❤️"); });
  expect(publish).toHaveBeenCalledTimes(1);
});

test("quick reaction recents use only the caller's explicit scope and never global persisted entries", async () => {
  const key = "buzz.quick-reaction-emojis.v1";
  window.localStorage.removeItem(`${key}:reaction-test-a`);
  window.localStorage.removeItem(`${key}:reaction-test-b`);
  window.localStorage.setItem(key, JSON.stringify([{ emoji: "🔥", count: 99, lastUsedAt: 1 }]));
  recordQuickReactionEmoji("🚀", "reaction-test-a");
  recordQuickReactionEmoji("😈");
  function Probe({ scope }: { scope: string | null }) {
    return <span>{useQuickReactionEmojis(4, [], scope).join(" ")}</span>;
  }
  const host = await render(<><Probe scope="reaction-test-a" /><Probe scope="reaction-test-b" /><Probe scope={null} /></>);
  const rows = host.querySelectorAll("span");
  expect(rows[0]?.textContent).toBe("🚀 👍 ❤️ 😂");
  expect(rows[1]?.textContent).toBe("👍 ❤️ 😂 🎉");
  expect(rows[2]?.textContent).toBe("👍 ❤️ 😂 🎉");
  expect(window.localStorage.getItem(key)).not.toContain("😈");
  window.localStorage.removeItem(key);
  window.localStorage.removeItem(`${key}:reaction-test-a`);
  window.localStorage.removeItem(`${key}:reaction-test-b`);
});
