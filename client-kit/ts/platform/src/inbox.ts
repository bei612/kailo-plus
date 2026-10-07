// Inbox aggregation extracted from Buzz Home (779af8886caae1317b4de962082429867ab61503).
// Hosts supply already admitted events. This module grants no access and holds no user state.
import type { ConversationView } from "@client-kit/contracts";
import type { BffClient } from "./client";

/** Original useOwnedAgentPubkeys, resolved from Kailo's existing governed installation directory. */
export async function loadOwnedAgentIdentities(client: Pick<BffClient, "agentInstallations">, workspaceId: string, ownerPrincipalId: string): Promise<ReadonlyMap<string, string>> {
  const keys = new Map<string, string>();
  const rejected = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallations(workspaceId, offset);
    if (!page || !Array.isArray(page.installations)) throw new Error("Invalid Installation directory");
    for (const installation of page.installations) {
      if (installation.workspaceId !== workspaceId) throw new Error("Installation scope mismatch");
      if (installation.ownerPrincipalId !== ownerPrincipalId || installation.state !== "ACTIVE" ||
          installation.resourceState !== "ACTIVE" || installation.agentPrincipalState !== "ACTIVE" ||
          installation.channelBinding?.status !== "ACTIVE" || installation.projection?.state !== "ACTIVE" ||
          installation.projection.generation !== installation.activeProjectionGeneration) {
        rejected.add(installation.resourceId);
        continue;
      }
      if (!installation.agentPubkey || !/^[0-9a-f]{64}$/.test(installation.agentPubkey)) throw new Error("Unverifiable Agent identity");
      const previous = keys.get(installation.resourceId);
      if (previous && previous !== installation.agentPubkey) throw new Error("Agent identity changed during directory read");
      keys.set(installation.resourceId, installation.agentPubkey);
    }
    if (page.nextOffset === undefined || page.nextOffset === null) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset) throw new Error("Invalid Installation cursor");
    offset = page.nextOffset;
  }
  return new Map([...keys].filter(([id]) => !rejected.has(id)));
}

/** Map Core preference bindings to original Relay channels for notification consumers. */
export function conversationNotificationMutes(
  legacy: ReadonlySet<string>, privateChannelIds: readonly string[],
  conversations: readonly Pick<ConversationView, "id" | "channelId">[],
  preferences: CollaborationUserState["conversationPreferences"],
): ReadonlySet<string> {
  const result = new Set(legacy);
  const bindings = new Map(conversations.map((item) => [item.channelId, item.id]));
  for (const channelId of privateChannelIds) {
    result.delete(channelId);
    const binding = bindings.get(channelId);
    // Missing/fetching projection is not evidence of an unmuted conversation.
    if (!binding || !preferences || preferences[binding]?.muted) result.add(channelId);
  }
  return result;
}
export type InboxEvent = {
  id: string;
  tags: string[][];
  createdAt: number;
  channelId: string | null;
  category: "mention" | "activity";
};

/** NIP-10 marked replies; unmarked e-tags are not invented thread edges. */
export function inboxThread(tags: string[][]) {
  const events = tags.filter(
    (tag) => tag[0] === "e" && typeof tag[1] === "string",
  );
  const reply = [...events].reverse().find((tag) => tag[3] === "reply");
  const parentId = reply?.[1] ?? null;
  return {
    parentId,
    rootId:
      parentId === null
        ? null
        : (events.find((tag) => tag[3] === "root")?.[1] ?? parentId),
  };
}

export function inboxReply(tags: string[][]) {
  return (
    inboxThread(tags).parentId !== null &&
    !tags.some((tag) => tag[0] === "broadcast" && tag[1] === "1")
  );
}

export function inboxConversation(item: Pick<InboxEvent, "id" | "tags">) {
  const thread = inboxThread(item.tags);
  return thread.rootId ?? thread.parentId ?? item.id;
}

/** Same event/root IDs in another admitted scope must never merge conversations. */
export function inboxScopeKey(
  item: Pick<InboxEvent, "id" | "tags" | "channelId">,
) {
  return `${item.channelId ?? ""}:${inboxConversation(item)}`;
}

export function aggregateInbox<T extends InboxEvent>(
  feed: { mentions: readonly T[]; activity: readonly T[] },
  getMessageReadAt?: (id: string) => number | null,
  getThreadReadAt?: (root: string, channel?: string | null) => number | null,
) {
  const groups = new Map<string, T[]>();
  for (const [category, items] of [
    ["mention", feed.mentions],
    ["activity", feed.activity],
  ] as const) {
    for (const source of items) {
      const item = { ...source, category };
      const key = inboxScopeKey(item);
      const group = groups.get(key) ?? [];
      if (!group.some((existing) => existing.id === item.id)) group.push(item);
      else if (category === "mention")
        group.find((existing) => existing.id === item.id)!.category = category;
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([scopeKey, items]) => {
      const conversationId = inboxConversation(items[0]!);
      const latest = items.reduce((left, right) =>
        right.createdAt > left.createdAt ? right : left,
      );
      const readAt = getThreadReadAt?.(conversationId, latest.channelId);
      const unread = items
        .filter((item) => {
          if (!inboxReply(item.tags)) return false;
          const mark = getMessageReadAt ? getMessageReadAt(item.id) : readAt;
          return mark !== undefined && item.createdAt > (mark ?? 0);
        })
        .sort((left, right) => left.createdAt - right.createdAt);
      return {
        scopeKey,
        conversationId,
        items,
        item: unread[0] ?? latest,
        latestActivityAt: latest.createdAt,
        unreadCount: unread.length,
        categories: [...new Set(items.map((item) => item.category))].sort(
          (a) => (a === "mention" ? -1 : 1),
        ),
      };
    })
    .sort((a, b) => b.latestActivityAt - a.latestActivityAt);
}

export function matchesInbox(
  item: {
    categories: readonly string[];
    groupItems: readonly (Pick<InboxEvent, "tags"> & { pubkey?: string })[];
    item?: { pubkey?: string };
  },
  filter: string,
  ownedAgentPubkeys?: ReadonlySet<string>,
) {
  const thread = item.groupItems.some((event) => inboxReply(event.tags));
  const representative = item.item ?? item.groupItems.at(-1);
  const ownedAgent = representative?.pubkey && ownedAgentPubkeys?.has(representative.pubkey.toLowerCase()) === true;
  if (filter === "agent_activity") return Boolean(ownedAgent);
  if (filter === "all") return item.categories.includes("mention") || thread || Boolean(ownedAgent);
  if (filter === "thread") return thread;
  return item.categories.includes(filter);
}

// These response shapes already belong to the Core user_state reader (DD-40).
// Unlike ReadMarkRequest they have no generated contract in this baseline.
export type CollaborationUserState = {
  workspacePreferences: Record<
    string,
    { starred: boolean; muted: boolean; updatedAt?: string }
  >;
  conversationPreferences?: Record<string, { starred: boolean; muted: boolean; updatedAt?: string }>;
  projectPreferences?: Record<string, {selected:boolean;updatedAt:string}>;
  readContexts: Record<string, string>;
  version: number;
};

export function checkedUserState(
  value: CollaborationUserState,
): CollaborationUserState {
  if (
    !value ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !value.readContexts ||
    Array.isArray(value.readContexts) ||
    typeof value.readContexts !== "object" ||
    !value.workspacePreferences ||
    typeof value.workspacePreferences !== "object" ||
    Array.isArray(value.workspacePreferences) ||
    (value.projectPreferences!==undefined&&(!value.projectPreferences||typeof value.projectPreferences!=="object"||Array.isArray(value.projectPreferences)||Object.entries(value.projectPreferences).some(([address,entry])=>!/^(30621|30617):[0-9a-f]{64}:.+$/.test(address)||!entry||typeof entry.selected!=="boolean"||typeof entry.updatedAt!=="string"||!Number.isFinite(Date.parse(entry.updatedAt))))) ||
    (value.conversationPreferences !== undefined &&
      (!value.conversationPreferences || typeof value.conversationPreferences !== "object" ||
       Array.isArray(value.conversationPreferences) || Object.values(value.conversationPreferences).some(
         (entry) => !entry || typeof entry.starred !== "boolean" || typeof entry.muted !== "boolean"))) ||
    Object.values(value.readContexts).some(
      (mark) => typeof mark !== "string" || !Number.isFinite(Date.parse(mark)),
    )
  ) {
    throw new Error("Invalid CollaborationUserState");
  }
  return value;
}

export function inboxReadAt(
  state: CollaborationUserState,
  context: string,
): number | null {
  const mark = state.readContexts[context];
  return mark === undefined ? null : Date.parse(mark) / 1000;
}
