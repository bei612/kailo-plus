import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { translate } from "@client-kit/platform/i18n";

import {
  buildInboxItems,
  formatInboxTypeLabel,
  getInboxConversationId,
  getInboxTypeLabel,
} from "./inbox.ts";
import { getHomeMessageCapabilities } from "./homeMessageCapabilities.ts";
import { hasInboxThreadContext } from "./inboxViewHelpers.ts";

test("Native Inbox's actual detail header and composer restore original DM context, draft and send target", async () => {
  const file = ts.createSourceFile("InboxDetailPane.tsx", readFileSync(new URL("../ui/InboxDetailPane.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Set(["isDirectMessage", "replyTarget", "composerParentEventId", "composerReplyTarget", "channelContextName", "isThreadContext", "contextLabel", "contextThreadRootId", "openContextLabel"]);
  const declarations = [];
  let composer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && bindings.has(node.name.getText(file))) declarations.push(`const ${node.getText(file)};`);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === "MessageComposer") composer = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(declarations.length, bindings.size);
  assert.ok(composer);
  const source = ts.transpile(`${declarations.join("\n")}return {contextLabel,contextThreadRootId,openContextLabel,composer:${composer}};`, {target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
  const project = new Function("React", "item", "displayMessages", "messages", "replyTargetId", "capturedDefaultParentId", "contextChannelName", "hasInboxThreadContext", "formatInboxTypeLabel", "locale", "t", "MessageComposer", "canReply", "isSendingReply", "disabledReplyReason", "setReplyTargetId", "onSendReply", source);
  const root = {id:"root",content:"root",authorLabel:"Original sender",tags:[["h",DM_CHANNEL_ID]]};
  const reply = {id:"reply",content:"reply",authorLabel:"Original sender",tags:[["h",DM_CHANNEL_ID],["e","root","","root"],["e","root","","reply"]]};
  const row = {id:"root",conversationId:`dm:${DM_CHANNEL_ID}`,channelLabel:"internal channel name",senderLabel:"Original sender",item:{...root,channelId:DM_CHANNEL_ID,channelType:"dm"},groupItems:[root,reply]};
  for (const locale of ["en","zh-CN"]) {
    const sends = [];
    const render = (value,replyId=null,canReply=true) => project(React,value,[root,reply],[root,reply],replyId,"captured-parent",null,hasInboxThreadContext,formatInboxTypeLabel,locale,(key,variables)=>translate(locale,key,variables),()=>null,canReply,false,"Actual refusal",()=>{},async payload=>sends.push(payload));
    const dm = render(row);
    assert.equal(dm.contextLabel, locale === "en" ? "DM with Original sender" : "与 Original sender 的私聊");
    assert.equal(dm.openContextLabel, locale === "en" ? "Open conversation" : "打开会话");
    assert.equal(dm.contextThreadRootId,null);
    assert.equal(dm.composer.props.draftKey,DM_CHANNEL_ID);
    assert.equal(dm.composer.props.placeholder,locale === "en" ? "Message Original sender" : "给 Original sender 发消息");
    await dm.composer.props.onSend("actual content",[],[]);
    assert.equal(sends.at(-1).parentEventId,null);
    const selected = render(row,"reply");
    await selected.composer.props.onSend("explicit reply",[],[]);
    assert.equal(sends.at(-1).parentEventId,"reply");
    assert.equal(selected.composer.props.draftKey,DM_CHANNEL_ID);
    assert.equal(render(row,null,false).composer.props.placeholder,"Actual refusal");
    const stream = render({...row,item:{...row.item,channelType:"stream"}});
    assert.equal(stream.contextLabel,locale === "en" ? "Thread in #internal channel name" : "#internal channel name 中的线程");
    assert.equal(stream.composer.props.draftKey,`thread:${row.conversationId}`);
    await stream.composer.props.onSend("stream reply",[],[]);
    assert.equal(sends.at(-1).parentEventId,"captured-parent");
  }
});

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const DM_CHANNEL_ID = "8ad375a7-6990-4b22-985f-e3fd34f634d7";

const channels = [
  {
    id: CHANNEL_ID,
    name: "buzz-bugs",
    channelType: "stream",
  },
  {
    id: DM_CHANNEL_ID,
    name: "dm-alice",
    channelType: "dm",
  },
];

function feedWith(overrides) {
  return {
    mentions: overrides.mentions ?? [],
    activity: overrides.activity ?? [],
  };
}

function item(overrides) {
  return {
    id: overrides.id ?? "event-1",
    kind: overrides.kind ?? 9,
    pubkey: overrides.pubkey ?? "author",
    content: overrides.content ?? "hello",
    createdAt: overrides.createdAt ?? 1,
    channelId: overrides.channelId ?? CHANNEL_ID,
    channelName: overrides.channelName ?? "",
    tags: overrides.tags ?? [["h", CHANNEL_ID]],
    category: overrides.category ?? "mention",
  };
}

test("the real Inbox row producer consumes locale without changing admitted identities or user content", () => {
  const feed = feedWith({ mentions: [item({ content: " \n " })], activity: [item({ id: "activity", category: "activity", content: "user text" })] });
  const english = buildInboxItems({ channels, feed });
  const chinese = buildInboxItems({ channels, feed, locale: "zh-CN" });
  const enMention = english.find(row => row.id === "event-1");
  const zhMention = chinese.find(row => row.id === "event-1");
  assert.equal(enMention.subject, "Mention");
  assert.equal(enMention.categoryLabel, "Mention");
  assert.equal(enMention.preview, "No additional details were attached to this event.");
  assert.equal(formatInboxTypeLabel(enMention), "Mentioned in #buzz-bugs");
  assert.equal(zhMention.subject, "提及");
  assert.equal(zhMention.categoryLabel, "提及");
  assert.equal(zhMention.preview, "此事件没有附加详情。");
  assert.equal(formatInboxTypeLabel(zhMention, "zh-CN"), "提及于 #buzz-bugs");
  assert.equal(chinese.find(row => row.id === "activity").preview, "user text");
  assert.equal(chinese.find(row => row.id === "activity").subject, "频道更新");
  assert.equal(chinese.find(row => row.id === "activity").categoryLabel, "动态");
  assert.deepEqual(chinese.map(row => [row.id, row.conversationId, row.groupItems, row.unreadCount]),
    english.map(row => [row.id, row.conversationId, row.groupItems, row.unreadCount]));
});

test("localized disabled-reply reasons preserve the actual admitted-channel guard", () => {
  const [row] = buildInboxItems({ channels, feed: feedWith({ mentions: [item({})] }) });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set(), "en"), {
    canReply: false, disabledReplyReason: "Open the linked channel to reply.",
  });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set(), "zh-CN"), {
    canReply: false, disabledReplyReason: "打开关联频道以回复。",
  });
  const noTarget = { ...row, item: { ...row.item, channelId: null } };
  assert.deepEqual(getHomeMessageCapabilities(noTarget, new Set([CHANNEL_ID]), "en"), {
    canReply: false, disabledReplyReason: "This inbox item does not have a reply target.",
  });
  assert.deepEqual(getHomeMessageCapabilities(noTarget, new Set([CHANNEL_ID]), "zh-CN"), {
    canReply: false, disabledReplyReason: "此收件箱条目没有可回复的目标。",
  });
  assert.deepEqual(getHomeMessageCapabilities(row, new Set([CHANNEL_ID]), "zh-CN"), { canReply: true, disabledReplyReason: null });
  assert.deepEqual(getHomeMessageCapabilities(null, new Set(), "zh-CN"), { canReply: false, disabledReplyReason: null });
});

test("mention rows use the channel list when feed channelName is blank", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [item({ category: "mention" })],
    }),
  });

  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Mentioned in",
    channelLabel: "buzz-bugs",
  });
});

test("owned top-level activity keeps the original channel label while only replies are threads", () => {
  const [topLevel] = buildInboxItems({ channels, feed: feedWith({ activity: [item({ category: "activity" })] }) });
  assert.deepEqual(getInboxTypeLabel(topLevel), { text: "Channel update in", channelLabel: "buzz-bugs" });
  assert.deepEqual(getInboxTypeLabel(topLevel, "zh-CN"), { text: "频道更新于", channelLabel: "buzz-bugs" });
});

test("DM rows use directory type, merge roots and select the earliest unread message", () => {
  const events = [1, 2, 3].map(index => item({ id: `dm-${index}`, category: "activity", createdAt: index,
    channelId: DM_CHANNEL_ID, tags: [["h", DM_CHANNEL_ID], ...(index === 3 ? [["e", "dm-1", "", "reply"]] : [])] }));
  const rows = buildInboxItems({ channels, feed: feedWith({ activity: events }), getChannelReadAt: () => 1, getMessageReadAt: () => 100 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].conversationId, `dm:${DM_CHANNEL_ID}`);
  assert.equal(rows[0].id, "dm-2");
  assert.equal(rows[0].unreadCount, 2);
  assert.equal(getInboxTypeLabel(rows[0]).channelLabel, null);
  assert.match(getInboxTypeLabel(rows[0]).text, /^DM from /);
});

test("thread activity rows use the channel list when feed channelName is blank", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          category: "activity",
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups are represented by the latest reply rather than the root", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          content: "Original thread starter",
          createdAt: 1,
        }),
        item({
          id: "reply-event",
          category: "activity",
          content: "New reply in the thread",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.id, "reply-event");
  assert.equal(inboxItem.preview, "New reply in the thread");
  assert.deepEqual(
    inboxItem.groupItems.map((groupItem) => groupItem.id),
    ["root-event", "reply-event"],
  );
  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups use the latest row label even when the root was a mention", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [
        item({
          id: "root-event",
          category: "mention",
          content: "Original mention",
          createdAt: 1,
        }),
      ],
      activity: [
        item({
          id: "reply-event",
          category: "activity",
          content: "New reply in the thread",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.id, "reply-event");
  assert.deepEqual(
    inboxItem.groupItems.map((groupItem) => groupItem.id),
    ["root-event", "reply-event"],
  );
  assert.deepEqual(getInboxTypeLabel(inboxItem), {
    text: "Thread in",
    channelLabel: "buzz-bugs",
  });
});

test("thread groups resume at the oldest unread reply", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          category: "activity",
          content: "Already read reply",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          category: "activity",
          content: "First unread reply",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
        item({
          id: "reply-3",
          category: "activity",
          content: "Newest unread reply",
          createdAt: 3,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-2", "", "reply"],
          ],
        }),
      ],
    }),
    getThreadReadAt: (rootId) => (rootId === "root-event" ? 1 : null),
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.preview, "First unread reply");
  assert.equal(inboxItem.latestActivityAt, 3);
  assert.equal(inboxItem.unreadCount, 2);
});

test("thread groups skip an individually read reply when choosing the resume point", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
      ],
    }),
    getMessageReadAt: (messageId) => (messageId === "reply-1" ? 1 : null),
    getThreadReadAt: () => null,
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.unreadCount, 1);
});

test("thread groups follow per-message unread state when the aggregate thread marker is newer", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-1",
          createdAt: 1,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
        item({
          id: "reply-2",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "reply-1", "", "reply"],
          ],
        }),
      ],
    }),
    getMessageReadAt: (messageId) => (messageId === "reply-1" ? 1 : null),
    getThreadReadAt: () => 2,
  });

  assert.equal(inboxItem.id, "reply-2");
  assert.equal(inboxItem.unreadCount, 1);
});

test("conversationId is stable when a live reply advances the representative", () => {
  // Simulate initial feed: thread root is the latest item.
  const before = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
      ],
    }),
  });

  assert.equal(before.length, 1);
  const conversationIdBefore = before[0].conversationId;

  // Simulate live reply arriving — root-event is now no longer the latest.
  const after = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: "reply-event",
          category: "activity",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(after.length, 1);
  // The conversation is still the same group — conversationId must be stable.
  assert.equal(after[0].conversationId, conversationIdBefore);
  // Representative is now the reply (latest by createdAt).
  assert.equal(after[0].id, "reply-event");
});

test("conversationId equals the thread root event id when a root tag is present", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "reply-event",
          category: "activity",
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "parent-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.conversationId, "root-event");
});

test("conversationId falls back to event id for a top-level item with no thread tags", () => {
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      mentions: [
        item({
          id: "top-level-event",
          category: "mention",
          tags: [["h", CHANNEL_ID]],
        }),
      ],
    }),
  });

  assert.equal(inboxItem.conversationId, "top-level-event");
  assert.equal(inboxItem.id, "top-level-event");
});

test("getInboxConversationId uses root tag when present", () => {
  const tags = [
    ["h", CHANNEL_ID],
    ["e", "root-event", "", "root"],
    ["e", "parent-event", "", "reply"],
  ];

  assert.equal(getInboxConversationId(tags, "reply-event"), "root-event");
});

test("getInboxConversationId falls back to eventId when no root tag", () => {
  const tags = [["h", CHANNEL_ID]];

  assert.equal(
    getInboxConversationId(tags, "top-level-event"),
    "top-level-event",
  );
});

test("old event still resolves to its conversation row via groupItems", () => {
  // Demonstrates that findItemByEventId searching groupItems works: the old
  // root event id is still present in groupItems even when a newer reply
  // becomes the representative.
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: "root-event",
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: "reply-event",
          category: "activity",
          createdAt: 2,
          tags: [
            ["h", CHANNEL_ID],
            ["e", "root-event", "", "root"],
            ["e", "root-event", "", "reply"],
          ],
        }),
      ],
    }),
  });

  // The representative is the reply, but the root is still in groupItems.
  assert.equal(inboxItem.id, "reply-event");
  assert.ok(
    inboxItem.groupItems.some((groupItem) => groupItem.id === "root-event"),
    "root-event should be in groupItems",
  );
});

// ── nested-anchor retention: feed advance must not lose the anchor ───────────

test("nested-anchor: old selected event stays resolvable by conversationId after representative advances", () => {
  // Scenario: user selected "reply-1" (a non-root reply) as the anchor.
  // A new deeper reply arrives and becomes the new representative.
  // The feed now contains only "reply-2" (the new representative) plus the
  // root. "reply-1" has been displaced from the live feed window.
  //
  // Properties that must hold after the feed advance:
  //   1. The conversationId derived from the LATCHED anchor's tags matches
  //      the conversationId of the surviving InboxItem (so row stays selected).
  //   2. The surviving InboxItem is resolvable by that conversationId.
  //   3. The anchor event id ("reply-1") is NOT in the new groupItems —
  //      confirming the eviction we're testing against.

  const ROOT_ID = "root-event";
  const ANCHOR_EVENT_ID = "reply-1"; // what the user clicked
  const LATEST_EVENT_ID = "reply-2"; // new representative after feed advance

  // Build inboxItems from the feed AFTER the advance (reply-1 is gone).
  const [inboxItem] = buildInboxItems({
    channels,
    feed: feedWith({
      activity: [
        item({
          id: ROOT_ID,
          category: "activity",
          createdAt: 1,
          tags: [["h", CHANNEL_ID]],
        }),
        item({
          id: LATEST_EVENT_ID,
          category: "activity",
          createdAt: 3,
          tags: [
            ["h", CHANNEL_ID],
            ["e", ROOT_ID, "", "root"],
            ["e", ANCHOR_EVENT_ID, "", "reply"],
          ],
        }),
        // reply-1 is intentionally absent — it has been evicted.
      ],
    }),
  });

  // Property 3: anchor event is NOT in the new groupItems.
  assert.ok(
    !inboxItem.groupItems.some((gi) => gi.id === ANCHOR_EVENT_ID),
    "evicted anchor must not be in groupItems after feed advance",
  );

  // Property 1: conversationId derived from the latched anchor's tags
  // (what HomeView computes as latchedConversationId) equals the surviving
  // InboxItem's conversationId.
  const anchorTags = [
    ["h", CHANNEL_ID],
    ["e", ROOT_ID, "", "root"],
    ["e", "some-parent", "", "reply"],
  ];
  const latchedConversationId = getInboxConversationId(
    anchorTags,
    ANCHOR_EVENT_ID,
  );
  assert.equal(
    latchedConversationId,
    inboxItem.conversationId,
    "latchedConversationId must match the surviving InboxItem's conversationId",
  );

  // Property 2: the surviving row is resolvable by that conversationId.
  assert.equal(inboxItem.conversationId, ROOT_ID);
  assert.equal(latchedConversationId, ROOT_ID);

  // The new representative is the latest reply.
  assert.equal(inboxItem.id, LATEST_EVENT_ID);
});
